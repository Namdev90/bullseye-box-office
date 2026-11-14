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
  var all=new LinkedHashMap<String,Integer>();all.put("normal",1);all.put("vip",1);all.put("vvip",1);all.put("mip",1);
  String current=WhatsAppDraft.message("0007","","Box office","North entrance",all,"Riya","PKT-A1B2C3D4",Map.of("normal",3),"https://sharepass.example.test",System.currentTimeMillis()+86400000);
  for(String required:new String[]{"Original plan for you: 3 Normal","Group balance on this receipt: 1 Normal + 1 VIP + 1 VVIP + 1 MIP","Collection code: 0007","IST (UTC+05:30)","Receipt: https://sharepass.example.test/pickup#0007.PKT-A1B2C3D4","Plans are not reservations"})if(!current.contains(required))throw new AssertionError(required);
  WhatsAppDraft.url("+12025550101",current);
  try{WhatsAppDraft.message("0007","","Box office","",all,"Riya","PKT-A1B2C3D4",null,"https://sharepass.example.test",1);throw new AssertionError();}catch(IllegalArgumentException expected){}
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
