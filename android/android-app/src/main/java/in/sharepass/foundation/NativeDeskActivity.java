package in.sharepass.foundation;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.widget.*;
import android.view.View;
import org.json.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

/** Native field client for the explicit synthetic loopback service. */
// shortcut: one active packet per phone; extend the journal when simultaneous offline packets are required.
public final class NativeDeskActivity extends Activity {
    private static final String BASE="http://127.0.0.1:8896";
    private static final String EVENT="training-event-001";
    private static final int BG=0xff171217, PANEL=0xff28202b, INK=0xfff2e8ef, RED=0xffbd1947;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private FieldJournal journal;
    private JSONObject data;
    private LinearLayout screen;
    private TextView banner;
    private volatile boolean busy, failed;
    private boolean home;
    private String token="";
    private final java.util.ArrayList<android.webkit.WebView> qrRenderers=new java.util.ArrayList<>();
    private final java.util.ArrayList<android.app.Dialog> scanDialogs=new java.util.ArrayList<>();
    private final android.os.Handler syncHandler=new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable syncTick=new Runnable(){public void run(){
        if(!busy&&!failed&&home&&data!=null&&data.has("assignment")&&!data.has("pending")){
            if(data.optJSONArray("operations").length()>data.optInt("accepted") || data.has("offline_deposit")&&!data.optBoolean("deposit_synced"))sync(false);
        }
        syncHandler.postDelayed(this,10000);
    }};
    private interface Work { void run() throws Exception; }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            journal=new FieldJournal(this);
            data=journal.read();
            if(!data.has("booth"))data.put("booth","B1");
            showHome();
        } catch(Exception error) { failed=true; plainFailure(); }
        if(android.os.Build.VERSION.SDK_INT>=33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
            android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::back);
    }
    private void plainFailure(){
        TextView view=new TextView(this);view.setPadding(28,70,28,28);view.setTextColor(INK);view.setBackgroundColor(BG);
        view.setText("The device journal cannot be opened. Stop physical handovers and reconcile this phone with a supervisor. Keep the app data for recovery.");
        setContentView(view);
    }
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private GradientDrawable surface(int color){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(12));return d;}
    private void page(String title,boolean isHome){
        for(android.app.Dialog dialog:new java.util.ArrayList<>(scanDialogs))dialog.dismiss();scanDialogs.clear();
        for(android.webkit.WebView qr:new java.util.ArrayList<>(qrRenderers))if(qrRenderers.remove(qr))qr.destroy();
        home=isHome; sharingPeople.clear();
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(BG);
        screen=new LinearLayout(this);screen.setOrientation(LinearLayout.VERTICAL);screen.setPadding(dp(20),dp(18),dp(20),dp(30));
        scroll.addView(screen);
        scroll.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;});
        setContentView(scroll);scroll.requestApplyInsets();
        text("SharePass",18,true);
        text(title,28,true);
        banner=text("Synthetic local test · "+data.optString("booth","B1"),13,false);
        if(!isHome)button("Back to field desk",this::showHome,false);
    }
    private TextView text(String value,int size,boolean bold){
        TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(INK);
        if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        t.setPadding(0,dp(6),0,dp(10));screen.addView(t);return t;
    }
    private Button button(String title,Runnable action,boolean primary){
        Button b=new Button(this);b.setText(title);b.setAllCaps(false);b.setTextSize(16);b.setTextColor(INK);
        b.setBackground(surface(primary?RED:PANEL));b.setMinHeight(dp(52));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=dp(10);b.setLayoutParams(lp);
        b.setOnClickListener(v->{if(!busy&&!failed)action.run();});
        screen.addView(b);return b;
    }
    private EditText field(String label,String value,boolean number){
        text(label,14,true);
        EditText e=new EditText(this);e.setText(value);e.setContentDescription(label);e.setTextColor(INK);e.setTextSize(18);
        e.setSingleLine(true);e.setPadding(dp(12),dp(10),dp(12),dp(10));e.setMinHeight(dp(50));e.setBackground(surface(PANEL));
        e.setInputType(number?InputType.TYPE_CLASS_NUMBER:InputType.TYPE_CLASS_TEXT);
        screen.addView(e);return e;
    }
    private void save() throws Exception {
        try {journal.write(data);}
        catch(Exception error){failed=true;throw new IOException("Device storage failed. Stop handovers and preserve this app for reconciliation.",error);}
    }
    private void problem(Exception error){
        if(failed){plainFailure();return;}
        if(banner!=null)banner.setText(error.getMessage()==null?"Action unavailable. Reconnect and retry.":error.getMessage());
    }
    private void task(Work work){
        if(busy)return;busy=true;banner.setText("Connecting…");
        worker.execute(()->{
            try {work.run();runOnUiThread(()->{busy=false;if(!isDestroyed())showHome();});}
            catch(Exception e){runOnUiThread(()->{busy=false;if(!isDestroyed())problem(e);});}
        });
    }
    private JSONObject raw(String path,JSONObject body,boolean authorized) throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(BASE+path).openConnection();
        c.setConnectTimeout(3500);c.setReadTimeout(5000);c.setInstanceFollowRedirects(false);
        if(authorized)c.setRequestProperty("Authorization","Bearer "+token);
        try {
            if(body!=null){byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);c.setRequestMethod("POST");c.setDoOutput(true);
                c.setRequestProperty("Content-Type","application/json");c.setFixedLengthStreamingMode(bytes.length);
                try(OutputStream out=c.getOutputStream()){out.write(bytes);}}
            int status=c.getResponseCode();
            InputStream stream=status<400?c.getInputStream():c.getErrorStream();
            if(stream==null)throw new IOException("Service unavailable. Keep the saved journal and retry.");
            ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] chunk=new byte[4096];int n;
            try(InputStream in=stream){while((n=in.read(chunk))!=-1){out.write(chunk,0,n);if(out.size()>1048576)throw new IOException("Response too large");}}
            JSONObject result=new JSONObject(out.toString("UTF-8"));
            if(status>=400)throw new IOException(result.optString("error","Service rejected this request")+" ("+status+")");
            return result;
        }finally{c.disconnect();}
    }
    private void connect() throws Exception {
        JSONObject session=raw("/showcase-session",null,false);
        if(!session.optBoolean("synthetic"))throw new IOException("Expected the isolated synthetic service");
        token=session.getString("token");data.put("event_name",session.optString("event_name","SharePass event"));
    }
    private JSONObject context() throws JSONException {return new JSONObject().put("event_id",EVENT).put("booth_id",data.getString("booth"));}
    private void showHome(){
        if(failed)return;
        page("Field desk",true);
        if(data.has("assignment")) {
            try {
                JSONObject a=data.getJSONObject("assignment"),p=a.getJSONObject("deposit");
                text("Assigned packet · "+p.getString("storage_location"),20,true);
                text("This phone controls this packet until it synchronizes and returns it.",14,false);
                text(balance(remaining()),20,true);
                text("Saved handovers: "+data.getJSONArray("operations").length()+" · synchronized: "+data.optInt("accepted"),14,false);
                if(data.has("pending"))button("Confirm pending handover",this::confirmScreen,true);
                else {
                    JSONObject available=remaining();int total=0;Iterator<String> keys=available.keys();
                    while(keys.hasNext())total+=available.getInt(keys.next());
                    if(total>0)button("Collector · hand over passes",this::collectScreen,true);
                    else text("All assigned passes have been collected.",16,true);
                }
                button("Synchronize",()->sync(false),false);
                button("Sync and return packet",()->sync(true),false);
            }catch(Exception e){problem(e);}
        } else {
            button("Depositor · new deposit",this::depositScreen,true);
            button("Collector · prepare packet",this::prepareScreen,true);
            if(data.has("slot"))text("One offline deposit code is ready on this phone.",14,true);
            else button("Prepare next offline deposit",()->task(()->{
                connect();
                if(!data.has("slot_request")){data.put("slot_request",context().put("assignment_id",UUID.randomUUID().toString()).put("secret",UUID.randomUUID().toString()+UUID.randomUUID()));save();}
                finishSlot();
            }),false);
        }
        if(data.has("deposit_request")||data.has("assignment_request")||data.has("slot_request"))button("Recover saved request",this::recover,true);
        if(data.has("receipt")){
            try {JSONObject r=data.getJSONObject("receipt");text("Last deposit code · "+r.getString("collection_code"),22,true);
                text("Packet "+r.getJSONObject("deposit").getString("id"),14,false);
                button("Share deposit · QR codes",this::shareReceipt,false);
            }catch(Exception e){problem(e);}
        }
        button("Refresh shared register",()->task(()->{connect();data.put("snapshot",raw("/api/state?event_id="+EVENT+"&booth_id="+data.getString("booth"),null,true));save();}),false);
        if(data.has("snapshot")) {
            try {JSONArray packets=data.getJSONObject("snapshot").getJSONArray("deposits");
                text("Last synchronized register",18,true);
                for(int i=0;i<packets.length();i++){JSONObject p=packets.getJSONObject(i);
                    text(p.getString("storage_location")+" · "+balance(p.getJSONObject("remaining"))+(p.optBoolean("offline_assigned")?" · Assigned offline":""),14,false);}
            }catch(Exception e){problem(e);}
        }
        button("Website presentation",()->{Intent intent=new Intent(this,MainActivity.class);intent.putExtra("webPreview",true);intent.putExtra("connectedShowcase",true);startActivity(intent);},false);
        if(!data.has("assignment")&&!data.has("assignment_request")&&!data.has("deposit_request")&&!data.has("slot")&&!data.has("slot_request")){
            button("Switch booth",()->{try {data.put("booth",data.getString("booth").equals("B1")?"B2":"B1");save();showHome();}catch(Exception e){problem(e);}},false);
        }
        text("Before disconnecting, prepare a packet or an offline deposit code. This phone retains exclusive control until synchronization and return.",13,false);
    }
    private String balance(JSONObject quantities) throws JSONException {
        StringBuilder text=new StringBuilder();Iterator<String> keys=quantities.keys();
        while(keys.hasNext()){String key=keys.next();if(text.length()>0)text.append(" · ");text.append(quantities.getInt(key)).append(" ").append(key);}
        return text.toString();
    }
    private JSONObject remaining() throws JSONException {
        JSONObject q=new JSONObject(data.getJSONObject("assignment").getJSONObject("deposit").getJSONObject("remaining").toString());
        JSONArray operations=data.getJSONArray("operations");
        for(int i=0;i<operations.length();i++){JSONObject used=operations.getJSONObject(i).getJSONObject("quantities");Iterator<String> keys=q.keys();while(keys.hasNext()){String k=keys.next();q.put(k,q.getInt(k)-used.getInt(k));}}
        return q;
    }
    private void depositScreen(){
        if(data.has("deposit_request")){recover();return;}
        page("New deposit",false);
        text("Count the physical passes, then enter the packet shelf.",14,false);
        EditText normal=field("Normal","0",true),vip=field("VIP","0",true),vvip=field("VVIP","0",true),shelf=field("Shelf","",false);
        EditText recipient=field("Recipient WhatsApp number (optional)","",false);
        recipient.setInputType(InputType.TYPE_CLASS_PHONE);
        CheckBox checked=new CheckBox(this);checked.setText("Counts checked and packet stored");checked.setTextColor(INK);screen.addView(checked);
        button("Save deposit",()->{
            try {
                if(!checked.isChecked())throw new Exception("Confirm the counts and physical storage");
                JSONObject quantities=new JSONObject().put("normal",count(normal)).put("vip",count(vip)).put("vvip",count(vvip));
                if(quantities.getInt("normal")+quantities.getInt("vip")+quantities.getInt("vvip")==0)throw new Exception("Enter at least one pass");
                String location=shelf.getText().toString().trim();if(location.isEmpty()||location.length()>30)throw new Exception("Enter a shelf of up to 30 characters");
                JSONObject request=context().put("request_id",UUID.randomUUID().toString()).put("quantities",quantities).put("storage_location",location).put("custody_confirmed",true);
                String phone=recipient.getText().toString().trim();
                data.put("deposit_phone",phone.isEmpty()?"":WhatsAppDraft.phone(phone));
                if(data.has("slot")){
                    JSONObject slot=data.getJSONObject("slot");
                    if(System.currentTimeMillis()/1000.0>=slot.getDouble("expires_at"))throw new Exception("Prepared code expired. Reconnect and reconcile.");
                    JSONObject p=new JSONObject().put("id",slot.getString("packet_id")).put("event_id",EVENT)
                        .put("storage_booth_id",data.getString("booth")).put("storage_location",location).put("code_expires_at",slot.getDouble("expires_at"))
                        .put("initial",quantities).put("remaining",new JSONObject(quantities.toString())).put("version",1);
                    data.put("receipt",new JSONObject().put("deposit",p).put("collection_code",slot.getString("collection_code")).put("sharing_phone",data.optString("deposit_phone")));
                    data.put("assignment",new JSONObject().put("assignment_id",slot.getString("assignment_id")).put("deposit",p));
                    data.put("owner",data.getJSONObject("slot_owner")).put("operations",new JSONArray()).put("accepted",0).put("code",slot.getString("collection_code"));
                    data.put("offline_deposit",new JSONObject().put("quantities",quantities).put("storage_location",location).put("custody_confirmed",true));
                    data.remove("slot");data.remove("slot_owner");data.remove("deposit_phone");
                    save();showHome();
                }else{data.put("deposit_request",request);save();recover();}
            }catch(Exception e){problem(e);}
        },true);
    }
    private int count(EditText field) throws Exception{
        String s=field.getText().toString();if(!s.matches("[0-9]{1,3}"))throw new Exception("Use whole counts from 0 to 100");
        int n=Integer.parseInt(s);if(n>100)throw new Exception("Maximum 100 per category");return n;
    }
    private void prepareScreen(){
        if(data.has("assignment_request")){recover();return;}
        page("Prepare offline packet",false);
        EditText code=field("Collection code","",false),packet=field("Physical packet ID","",false);
        text("Match the physical packet before assigning it. Other phones and the website will be blocked from changing it until this phone returns it.",14,false);
        button("Assign to this phone",()->{
            String value=code.getText().toString().trim().toUpperCase(java.util.Locale.ROOT),id=packet.getText().toString().trim();
            if(!value.matches("[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}")){banner.setText("Enter the four-character code");return;}
            task(()->{
                connect();JSONObject verified=raw("/api/verify",context().put("collection_code",value),true);
                JSONObject p=verified.getJSONObject("deposit");
                if(!verified.getBoolean("release_allowed")||!p.getString("id").equals(id))throw new Exception("Packet or booth mismatch, or already assigned");
                JSONObject req=context().put("assignment_id",UUID.randomUUID().toString()).put("secret",UUID.randomUUID().toString()+UUID.randomUUID())
                    .put("deposit_id",id).put("packet_id",id).put("version",p.getInt("version"));
                data.put("assignment_request",req).put("code",value);save();
                finishPrepare();
            });
        },true);
    }
    private void finishPrepare() throws Exception{
        JSONObject result=raw("/api/offline/assign",data.getJSONObject("assignment_request"),true);
        if(result.optBoolean("closed"))throw new Exception("Assignment closed. Reconcile local records with a supervisor.");
        data.put("assignment",result).put("operations",new JSONArray()).put("accepted",0);
        // Keep the original request and capability until the packet is returned.
        data.put("owner",data.getJSONObject("assignment_request"));data.remove("assignment_request");save();
    }
    private void recover(){
        task(()->{
            connect();
            if(data.has("deposit_request")){JSONObject result=raw("/api/deposits",data.getJSONObject("deposit_request"),true);
                result.put("sharing_phone",data.optString("deposit_phone"));
                data.put("receipt",result);data.remove("deposit_request");data.remove("deposit_phone");save();}
            if(data.has("assignment_request"))finishPrepare();
            if(data.has("slot_request"))finishSlot();
        });
    }
    private void finishSlot() throws Exception{
        JSONObject result=raw("/api/offline/new",data.getJSONObject("slot_request"),true);
        data.put("slot",result).put("slot_owner",data.getJSONObject("slot_request"));data.remove("slot_request");save();
    }
    private void collectScreen(){
        try {
            if(data.getJSONArray("operations").length()>=100)throw new Exception("Synchronize and return this packet before more handovers");
            if(System.currentTimeMillis()/1000.0>=data.getJSONObject("assignment").getJSONObject("deposit").getDouble("code_expires_at"))throw new Exception("Event or code expired. Synchronize and reconcile.");
            JSONObject available=remaining();
            page("Collect passes",false);
            text("Packet "+data.getJSONObject("assignment").getJSONObject("deposit").getString("id"),14,false);
            EditText code=field("Shared collection code","",false);
            java.util.LinkedHashMap<String,EditText> fields=new java.util.LinkedHashMap<>();
            Iterator<String> keys=available.keys();
            while(keys.hasNext()){String k=keys.next();fields.put(k,field(k+" · "+available.getInt(k)+" available","0",true));}
            CheckBox match=new CheckBox(this);match.setText("Physical packet and shelf match");match.setTextColor(INK);screen.addView(match);
            button("Review handover",()->{
                try {
                    if(!match.isChecked()||!data.getString("code").equals(code.getText().toString().trim().toUpperCase(java.util.Locale.ROOT)))throw new Exception("Match the shared code and physical packet");
                    JSONObject q=new JSONObject();int total=0;
                    for(String k:fields.keySet()){int n=count(fields.get(k));if(n>available.getInt(k))throw new Exception("Quantity exceeds the remaining "+k);q.put(k,n);total+=n;}
                    if(total==0)throw new Exception("Choose at least one pass");
                    data.put("pending",new JSONObject().put("id",UUID.randomUUID().toString()).put("quantities",q).put("handed_over",true));save();confirmScreen();
                }catch(Exception e){problem(e);}
            },true);
        }catch(Exception e){problem(e);}
    }
    private void confirmScreen(){
        try {
            page("Confirm physical handover",false);
            text(balance(data.getJSONObject("pending").getJSONObject("quantities")),23,true);
            text("Hand these passes over once. If interrupted, reconcile the physical packet before confirming. This record survives an app restart.",15,false);
            button("Passes handed over",()->{
                try {data.getJSONArray("operations").put(data.getJSONObject("pending").put("recorded_at",System.currentTimeMillis()/1000.0));data.remove("pending");save();showHome();}
                catch(Exception e){failed=true;plainFailure();}
            },true);
        }catch(Exception e){problem(e);}
    }
    private void sync(boolean close){
        if(data.has("pending")){banner.setText("Confirm or reconcile the pending physical handover first");return;}
        task(()->{
            connect();
            JSONObject owner=data.getJSONObject("owner");
            JSONObject req=context().put("assignment_id",owner.getString("assignment_id")).put("secret",owner.getString("secret"))
                .put("operations",data.getJSONArray("operations")).put("close",close);
            if(data.has("offline_deposit"))req.put("deposit",data.getJSONObject("offline_deposit"));
            JSONObject result=raw("/api/offline/sync",req,true);
            data.put("accepted",result.getInt("accepted")).put("deposit_synced",true);
            if(result.getBoolean("closed")){data.remove("assignment");data.remove("owner");data.remove("operations");data.remove("code");data.remove("offline_deposit");data.remove("deposit_synced");}
            save();
            data.put("snapshot",raw("/api/state?event_id="+EVENT+"&booth_id="+data.getString("booth"),null,true));save();
        });
    }
    private void back(){if(busy)return;if(!home&&!failed)showHome();else finish();}
    private static final class ShareRecipient {
        int index;
        EditText name,phone;
        TextView preview;
        String prepared="";
    }
    private final java.util.ArrayList<ShareRecipient> sharingPeople=new java.util.ArrayList<>();
    private JSONObject sharingReceipt,sharingDeposit;
    private ShareRecipient currentScan;
    private void shareReceipt(){
        try {
            JSONObject receipt=data.getJSONObject("receipt"),deposit=receipt.getJSONObject("deposit");
            if(System.currentTimeMillis()/1000.0>=deposit.getDouble("code_expires_at"))throw new Exception("This code has expired. Reconcile the packet.");
            page("Share collection details",false);
            sharingReceipt=receipt;sharingDeposit=deposit;
            button("Add recipient",()->{
                if(sharingPeople.size()>=10){banner.setText("Up to 10 recipients per sharing view");return;}
                addRecipient("");
            },false);
            addRecipient(receipt.optString("sharing_phone"));
        }catch(Exception e){problem(e);}
    }
    private void addRecipient(String initialPhone){
        ShareRecipient person=new ShareRecipient();person.index=sharingPeople.size()+1;sharingPeople.add(person);
        text("Recipient "+person.index,21,true);
        person.name=field("Recipient "+person.index+" name","",false);
        person.phone=field("Recipient "+person.index+" phone",initialPhone,false);person.phone.setInputType(InputType.TYPE_CLASS_PHONE);
        person.preview=text("",14,false);person.preview.setVisibility(View.GONE);
        button("Show QR for recipient "+person.index,()->openScan(person),true);
        button("Preview message for recipient "+person.index,()->person.preview.setVisibility(person.preview.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE),false);
        button("Copy message for recipient "+person.index,()->{
            if(person.prepared.isEmpty()){banner.setText("Generate a preview first");return;}
            ((android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(android.content.ClipData.newPlainText("SharePass",person.prepared));
            banner.setText("Message copied");
        },false);
        android.text.TextWatcher clear=new android.text.TextWatcher(){
            public void beforeTextChanged(CharSequence s,int start,int count,int after){}
            public void onTextChanged(CharSequence s,int start,int before,int count){person.prepared="";person.preview.setText("");}
            public void afterTextChanged(android.text.Editable e){}
        };
        person.name.addTextChangedListener(clear);person.phone.addTextChangedListener(clear);
    }
    private void openScan(ShareRecipient person){
        try{
            java.util.LinkedHashMap<String,Integer> counts=new java.util.LinkedHashMap<>();
            JSONObject initial=sharingDeposit.getJSONObject("initial");Iterator<String> keys=initial.keys();
            while(keys.hasNext()){String key=keys.next();counts.put(key,initial.getInt(key));}
            String code=sharingReceipt.getString("collection_code");
            String message=WhatsAppDraft.message(code,data.optString("event_name","SharePass event"),sharingDeposit.getString("storage_booth_id"),sharingDeposit.getString("storage_location"),counts,person.name.getText().toString());
            String recipient=WhatsAppDraft.phone(person.phone.getText().toString());
            String url=WhatsAppDraft.url(recipient,message);
            for(android.app.Dialog existing:new java.util.ArrayList<>(scanDialogs))existing.dismiss();
            android.webkit.WebView qr=createQr(url,"Recipient "+person.index+" WhatsApp QR");
            float[] start={0,0};boolean[] touching={false};
            android.app.Dialog dialog=new android.app.Dialog(this){
                @Override public boolean dispatchTouchEvent(android.view.MotionEvent e){
                    if(e.getActionMasked()==android.view.MotionEvent.ACTION_DOWN){start[0]=e.getX();start[1]=e.getY();touching[0]=true;}
                    if(e.getActionMasked()==android.view.MotionEvent.ACTION_CANCEL)touching[0]=false;
                    if(e.getActionMasked()==android.view.MotionEvent.ACTION_UP&&touching[0]){
                        touching[0]=false;float dx=e.getX()-start[0],dy=e.getY()-start[1];
                        if(Math.max(Math.abs(dx),Math.abs(dy))>dp(45)){
                            if(Math.abs(dy)>Math.abs(dx)){
                                int next=(sharingPeople.indexOf(person)+(dy<0?1:sharingPeople.size()-1))%sharingPeople.size();
                                openScan(sharingPeople.get(next));
                            }
                            return true;
                        }
                    }
                    return super.dispatchTouchEvent(e);
                }
            };
            scanDialogs.add(dialog);
            LinearLayout scan=new LinearLayout(this);scan.setOrientation(LinearLayout.VERTICAL);scan.setGravity(android.view.Gravity.CENTER);scan.setPadding(dp(18),dp(18),dp(18),dp(18));scan.setBackgroundColor(BG);
            Button close=new Button(this);close.setText("×");close.setContentDescription("Close QR");close.setTextColor(INK);close.setBackground(surface(PANEL));close.setOnClickListener(v->dialog.dismiss());
            LinearLayout.LayoutParams closeLayout=new LinearLayout.LayoutParams(dp(48),dp(48));closeLayout.gravity=android.view.Gravity.END;scan.addView(close,closeLayout);
            String who=person.name.getText().toString().trim();if(who.isEmpty())who=recipient;
            TextView label=new TextView(this);label.setText("WhatsApp · "+who);label.setTextColor(INK);scan.addView(label);
            TextView codeLabel=new TextView(this);codeLabel.setText(code);codeLabel.setTextSize(36);codeLabel.setTypeface(Typeface.DEFAULT,Typeface.BOLD);codeLabel.setTextColor(INK);codeLabel.setGravity(android.view.Gravity.CENTER);codeLabel.setPadding(0,dp(8),0,dp(12));scan.addView(codeLabel);
            int side=Math.max(dp(120),Math.min(dp(320),Math.min(getResources().getDisplayMetrics().widthPixels-dp(40),getResources().getDisplayMetrics().heightPixels-dp(240))));
            scan.addView(qr,new LinearLayout.LayoutParams(side,side));
            LinearLayout nav=new LinearLayout(this);nav.setGravity(android.view.Gravity.CENTER);
            String[] labels={"‹","›"};
            for(int i=0;i<labels.length;i++){
                final int action=i;Button b=new Button(this);b.setText(labels[i]);b.setAllCaps(false);b.setTextColor(INK);b.setBackgroundColor(BG);
                b.setContentDescription(new String[]{"Previous recipient","Next recipient"}[i]);
                b.setOnClickListener(v->{openScan(sharingPeople.get((sharingPeople.indexOf(person)+(action==1?1:sharingPeople.size()-1))%sharingPeople.size()));});
                nav.addView(b,new LinearLayout.LayoutParams(dp(68),dp(48)));
            }
            scan.addView(nav);
            if(getResources().getConfiguration().orientation==android.content.res.Configuration.ORIENTATION_LANDSCAPE){
                scan.removeView(qr);scan.removeView(nav);
                LinearLayout info=new LinearLayout(this);info.setOrientation(LinearLayout.VERTICAL);
                while(scan.getChildCount()>0){View child=scan.getChildAt(0);scan.removeView(child);info.addView(child);}
                info.addView(nav);
                scan.setOrientation(LinearLayout.HORIZONTAL);
                scan.addView(info,new LinearLayout.LayoutParams(0,-2,1));
                int landscapeSide=Math.min(dp(320),Math.min(getResources().getDisplayMetrics().heightPixels-dp(100),getResources().getDisplayMetrics().widthPixels/2-dp(48)));
                scan.addView(qr,new LinearLayout.LayoutParams(landscapeSide,landscapeSide));
            }
            dialog.setContentView(scan);dialog.setOnDismissListener(d->{scanDialogs.remove(dialog);if(qrRenderers.remove(qr))qr.destroy();});
            dialog.show();dialog.getWindow().setLayout(-1,-1);
            currentScan=person;
            person.prepared=message;person.preview.setText(message);
        }catch(Exception error){Toast.makeText(this,error.getMessage(),Toast.LENGTH_LONG).show();problem(error);}
    }
    private android.webkit.WebView createQr(String url,String label) throws Exception{
        android.webkit.WebView qr=QrPreview.create(this,url,label);
        qrRenderers.add(qr);
        return qr;
    }
    @android.annotation.SuppressLint("GestureBackNavigation")
    @SuppressWarnings("deprecation") @Override public void onBackPressed(){back();}
    @Override public void onConfigurationChanged(android.content.res.Configuration configuration){
        super.onConfigurationChanged(configuration);
        ShareRecipient person=currentScan;
        if(!scanDialogs.isEmpty()&&sharingPeople.contains(person))screen.post(()->{if(!scanDialogs.isEmpty()&&sharingPeople.contains(person))openScan(person);});
    }
    @Override protected void onResume(){super.onResume();syncHandler.postDelayed(syncTick,2000);}
    @Override protected void onPause(){syncHandler.removeCallbacks(syncTick);super.onPause();}
    @Override protected void onDestroy(){for(android.app.Dialog dialog:new java.util.ArrayList<>(scanDialogs))dialog.dismiss();scanDialogs.clear();for(android.webkit.WebView qr:new java.util.ArrayList<>(qrRenderers))if(qrRenderers.remove(qr))qr.destroy();worker.shutdown();super.onDestroy();}
}
