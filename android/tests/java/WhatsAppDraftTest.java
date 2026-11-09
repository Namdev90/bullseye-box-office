package in.sharepass.foundation;
import java.util.LinkedHashMap;
import java.util.Map;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
public final class WhatsAppDraftTest {
 public static void main(String[] args) {
  var counts=new LinkedHashMap<String,Integer>();counts.put("normal",4);counts.put("vip",2);
  String message=WhatsAppDraft.message("K7M4","Synthetic event","B2","North entrance / Shelf 4",counts);
  String url=WhatsAppDraft.url("+1 (202) 555-0101",message);
  String noEvent=WhatsAppDraft.message("K7M4","","Box office","",counts);
  String custom=WhatsAppDraft.message("1010","","Box office","",Map.of("mip",1));
  String reuse=WhatsAppDraft.message("1010","","Box office","",counts,"Fixture","PKT-1234ABCD");
  if(!reuse.contains("Use code 1010 and pickup reference PKT-1234ABCD"))throw new AssertionError(reuse);
  try{WhatsAppDraft.message("1010","","Box office","",counts,"Fixture","BAD");throw new AssertionError();}
  catch(IllegalArgumentException expected){}
  if(!custom.contains("1 MIP")||!custom.contains("Use code 1010"))throw new AssertionError(custom);
  if(!noEvent.contains("Use code K7M4 to collect from Box office."))throw new AssertionError();
  if(!url.startsWith("https://wa.me/12025550101?text="))throw new AssertionError();
  if(!URLDecoder.decode(url.substring(url.indexOf('=')+1),StandardCharsets.UTF_8).equals(message))throw new AssertionError();
  for(String input:new String[]{"8123456789","0 81234 56789","+91 81234 56789","00918123456789"}){
   if(!WhatsAppDraft.complete(input)||!WhatsAppDraft.phone(input).equals("918123456789"))throw new AssertionError(input);
  }
  if(WhatsAppDraft.complete("+447700900123")||!WhatsAppDraft.phone("+447700900123").equals("447700900123"))throw new AssertionError();
  for(String bad:new String[]{"","0012","812345678","+91812345678","2025550103","https://example.com","+1\n2025550101"}){
   try{WhatsAppDraft.phone(bad);throw new AssertionError(bad);}catch(IllegalArgumentException expected){}
  }
  System.out.println("PASS native recipient, prefilled details and invalid input checks");
 }
}
