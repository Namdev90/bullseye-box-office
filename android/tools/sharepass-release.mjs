import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash,verify,X509Certificate} from 'node:crypto';
import {constants,copyFileSync,mkdtempSync,mkdirSync,readFileSync,statSync,unlinkSync,rmdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageName='in.sharepass.foundation';
const signerSha256='0a8b400966fd754c6db2b33b94f78c9898803aff37718fa34c34aef77b642c12';
const manifestName='sharepass-android-update.json';
const repository='Namdev90/bullseye-box-office';
const project='https://github.com/'+repository;
const workflow='sharepass-android-release.yml';
const limit=25*1024*1024;
const firstUpdateVersionCode=18;

function apkName(versionName){return `SharePass-Android-${versionName}.apk`;}
function canonical(manifest){
  return Buffer.from([
    'sharepass-android-update-v1',manifest.packageName,manifest.versionCode,manifest.versionName,
    manifest.apkUrl,manifest.size,manifest.sha256,manifest.signerSha256,''
  ].join('\n'),'utf8');
}

function inspect(apk,versionName,code,sha256){
  assert(/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(versionName),'Expected an exact X.Y.Z version');
  assert(/^[1-9]\d{0,9}$/.test(code)&&Number(code)<=2100000000,'Invalid Android version code');
  assert(/^[a-f0-9]{64}$/.test(sha256),'Expected the approved lowercase APK SHA-256');
  const {size}=statSync(apk);
  assert(size>0&&size<=limit,'APK size is outside the 25 MiB limit');
  assert.equal(createHash('sha256').update(readFileSync(apk)).digest('hex'),sha256,'APK digest differs from the approved digest');

  const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;
  assert(sdk,'Set ANDROID_HOME to the Android SDK');
  const tools=join(sdk,'build-tools','36.0.0');
  const suffix=process.platform==='win32'?'.exe':'';
  const java=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin','java'+suffix):'java';
  const tool=(name,args)=>execFileSync(join(tools,name+suffix),args,{encoding:'utf8'});
  tool('zipalign',['-c','-P','16','4',apk]);
  const badging=tool('aapt',['dump','badging',apk]);
  const identity=badging.match(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m);
  assert.deepEqual(identity?.slice(1),[packageName,code,versionName],'APK package or version does not match');
  assert(!/^application-debuggable\s*$/m.test(badging),'A debuggable APK cannot be published');

  const details=execFileSync(java,['-jar',join(tools,'lib','apksigner.jar'),'verify','--verbose','--print-certs','--print-certs-pem',apk],{encoding:'utf8'});
  assert(/^Verified using v[23] scheme .*: true\r?$/m.test(details),'APK has no verified v2 or v3 signature');
  assert(/^Number of signers: 1\r?$/m.test(details),'APK must have exactly one signer');
  const [pem,...extra]=details.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)||[];
  assert(pem&&!extra.length,'APK must have one signing certificate');
  const certificate=new X509Certificate(pem);
  assert.equal(certificate.fingerprint256.replaceAll(':','').toLowerCase(),signerSha256,'APK signer is outside the approved channel');
  assert.equal(certificate.publicKey.asymmetricKeyType,'rsa','The update channel requires an RSA signer');

  return {java,certificate,metadata:{schema:1,packageName,versionCode:Number(code),versionName,
    apkUrl:`${project}/releases/download/android-v${versionName}/${apkName(versionName)}`,sha256,size,signerSha256}};
}

function checkManifest(manifest,metadata,certificate){
  assert(manifest&&typeof manifest==='object'&&!Array.isArray(manifest),'Invalid update manifest');
  const {signature,...fields}=manifest;
  assert.deepEqual(fields,metadata,'Signed manifest does not describe this exact APK');
  assert(typeof signature==='string'&&signature.length<=2048,'Invalid update signature');
  const bytes=Buffer.from(signature,'base64');
  assert.equal(bytes.toString('base64'),signature,'Expected canonical Base64 signature');
  assert(verify('RSA-SHA256',canonical(metadata),certificate.publicKey,bytes),'Update signature does not match the APK signer');
}

function stage(apk,manifestPath,metadata,sourceCommit,mode){
  assert(/^[a-f0-9]{40}$/.test(sourceCommit),'An exact approved GitHub source commit is required');
  assert(['archive','latest'].includes(mode),'Choose archive or latest');
  assert(mode==='archive'||metadata.versionCode>=firstUpdateVersionCode,'Android versions before 0.9.8 are archive-only');
  assert.equal(basename(apk),apkName(metadata.versionName),'Use the prepared APK file name');
  assert.equal(basename(manifestPath),manifestName,'Use the prepared manifest file name');
  function github(args,allowMissing=false){
    try{return execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
    catch(error){if(allowMissing&&String(error.stderr).includes('(HTTP 404)'))return null;throw error;}
  }
  assert.equal(github(['api',`repos/${repository}/commits/${sourceCommit}`,'--jq','.sha']),sourceCommit,'Approved source commit is unavailable');
  assert.equal(github(['api',`repos/${repository}/actions/workflows/${workflow}`,'--jq','.state']),'active','Enable the verification workflow on main first');
  const tag='android-v'+metadata.versionName;
  const tagRef=github(['api',`repos/${repository}/git/ref/tags/${tag}`,'--jq','.ref'],true);
  if(tagRef!==null){
    assert.equal(tagRef,'refs/tags/'+tag,'GitHub returned an unexpected release tag');
    const taggedCommit=github(['api',`repos/${repository}/commits/${encodeURIComponent(tagRef)}`,'--jq','.sha']);
    assert.equal(taggedCommit,sourceCommit,'Existing release tag points to a different source commit');
  }
  execFileSync('gh',['release','create',tag,apk,resolve(manifestPath),'--repo',repository,
    '--draft','--latest=false','--target',sourceCommit,'--title','SharePass Android '+metadata.versionName,
    '--notes',mode==='archive'?'Archived signed APK for SharePass Android.':'Verified direct-download APK for SharePass Android.'],{stdio:'inherit'});
  execFileSync('gh',['workflow','run',workflow,'--repo',repository,'--ref','main','--json'],{
    input:JSON.stringify({tag,version_code:String(metadata.versionCode),apk_sha256:metadata.sha256,promote_latest:String(mode==='latest')}),
    stdio:['pipe','inherit','inherit']
  });
  console.log(`Draft ${tag} created and verification requested on main.`);
}

function run(){
  const [command,apkPath,version,code,approvedSha,extra,aliasOrSource,outputOrMode]=process.argv.slice(2);
  assert(['inspect','prepare','verify','stage'].includes(command)&&apkPath&&version&&code&&approvedSha,
    'Usage: sharepass-release.mjs inspect|prepare|verify|stage APK VERSION VERSION_CODE APPROVED_SHA256 [KEYSTORE ALIAS OUTPUT_DIR | MANIFEST [SOURCE_COMMIT archive|latest]]');
  const apk=resolve(apkPath),{java,certificate,metadata}=inspect(apk,version,code,approvedSha);
  if(command==='inspect'){console.log(JSON.stringify(metadata,null,2));return;}
  if(command==='verify'||command==='stage'){
    assert(extra&&statSync(extra).size<=8192,'A bounded signed manifest is required');
    checkManifest(JSON.parse(readFileSync(extra,'utf8')),metadata,certificate);
    console.log(`Verified SharePass ${version} APK and signed update manifest.`);
    if(command==='stage')stage(apk,extra,metadata,aliasOrSource,outputOrMode);
    return;
  }
  assert(extra&&aliasOrSource&&outputOrMode,'Preparing a release requires a local keystore, key alias, and output directory');
  const temporary=mkdtempSync(join(tmpdir(),'sharepass-release-'));
  const message=join(temporary,'manifest.txt'),signed=join(temporary,'signature.txt');
  try{
    writeFileSync(message,canonical(metadata),{flag:'wx'});
    const signer=fileURLToPath(new URL('./SignSharePassUpdate.java',import.meta.url));
    const signing=spawnSync(java,[signer,resolve(extra),aliasOrSource,message,signed],{stdio:'inherit'});
    assert.equal(signing.status,0,'Local manifest signing did not complete');
    const manifest={...metadata,signature:readFileSync(signed,'utf8')};
    checkManifest(manifest,metadata,certificate);
    const folder=resolve(outputOrMode);
    mkdirSync(folder,{recursive:true});
    writeFileSync(join(folder,manifestName),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    copyFileSync(apk,join(folder,apkName(version)),constants.COPYFILE_EXCL);
    console.log(`Prepared verified APK and signed manifest in ${folder}.`);
  }finally{
    for(const file of [message,signed]){
      try{unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    rmdirSync(temporary);
  }
}
try{run();}catch(error){console.error(error.message);process.exitCode=1;}
