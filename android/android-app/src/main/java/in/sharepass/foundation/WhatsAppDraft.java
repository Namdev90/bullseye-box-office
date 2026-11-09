package in.sharepass.foundation;

import java.net.URLEncoder;
import java.util.Map;

final class WhatsAppDraft {
    static String phone(String value) {
        String raw = value == null ? "" : value.trim();
        if (raw.length() <= 40 && raw.matches("(?:\\+|00)?[0-9 ().-]+")) {
            String digits = raw.replaceAll("[^0-9]", "");
            boolean explicit = raw.startsWith("+") || raw.startsWith("00");
            if (raw.startsWith("00")) digits = digits.substring(2);
            if (!explicit && digits.matches("0?[6-9][0-9]{9}")) {
                digits = "91" + digits.substring(digits.length() - 10);
            } else if (!explicit && digits.length() <= 10) {
                throw new IllegalArgumentException("Include the country code for an international number");
            }
            if (digits.matches("[1-9][0-9]{7,14}")
                    && (!digits.startsWith("91") || digits.matches("91[6-9][0-9]{9}"))
                    && (!digits.startsWith("1") || digits.matches("1[2-9][0-9]{9}"))) return digits;
        }
        throw new IllegalArgumentException("Enter a valid WhatsApp number");
    }
    static boolean complete(String value) {
        try {
            String digits = phone(value);
            return digits.startsWith("91") || digits.startsWith("1");
        } catch (IllegalArgumentException invalid) {
            return false;
        }
    }
    static String message(String code,String event,String booth,String location,Map<String,Integer> counts){
        return message(code,event,booth,location,counts,"");
    }
    static String message(String code,String event,String booth,String location,Map<String,Integer> counts,String name){
        return message(code,event,booth,location,counts,name,"");
    }
    static String message(String code,String event,String booth,String location,Map<String,Integer> counts,String name,String reference){
        if(name==null||name.length()>80||name.matches("(?s).*[\\x00-\\x1f\\x7f].*"))throw new IllegalArgumentException("Use a name of up to 80 characters");
        if(!code.matches("[A-Z0-9]{4}"))throw new IllegalArgumentException("Invalid collection code");
        if(!reference.isEmpty()&&!reference.matches("PKT-[A-F0-9]{8}"))throw new IllegalArgumentException("Invalid pickup reference");
        for(String value:new String[]{event,booth,location})
            if(value==null||value.length()>100||value.matches("(?s).*[\\x00-\\x1f\\x7f].*"))throw new IllegalArgumentException("Invalid pickup details");
        if(booth.trim().isEmpty())throw new IllegalArgumentException("Enter a pickup counter");
        StringBuilder quantities=new StringBuilder();
        for(Map.Entry<String,Integer> entry:counts.entrySet()){
            if(!entry.getKey().matches("[A-Za-z][A-Za-z0-9 _-]{0,39}")||entry.getValue()<0||entry.getValue()>10000)throw new IllegalArgumentException("Invalid pass quantities");
            if(entry.getValue()==0)continue;
            if(quantities.length()>0)quantities.append(" + ");
            String label=entry.getKey().equals("normal")?"Normal":entry.getKey().matches("vip|vvip|mip")?entry.getKey().toUpperCase(java.util.Locale.ROOT):entry.getKey();
            quantities.append(entry.getValue()).append(" ").append(label);
        }
        if(quantities.length()==0)throw new IllegalArgumentException("Pass counts required");
        return "Hi"+(name.trim().isEmpty()?"":" "+name.trim())+"! I’ve left "+quantities+" passes for our group with SharePass by Bullseye Entertainment.\n\n"+
            (event.trim().isEmpty()?"Use code ":"For "+event.trim()+", use code ")+code+
            (reference.isEmpty()?"":" and pickup reference "+reference)+" to collect from "+booth.trim()+
            (location.trim().isEmpty()?"":", "+location.trim())+".\n\n"+
            "You can pick up some or all of the passes still available for our group.";
    }
    static String url(String recipient, String message) {
        String result = "https://wa.me/" + phone(recipient) + "?text=" + encode(message);
        if (result.length() > 1200) throw new IllegalArgumentException("Shorten the pickup details for this QR");
        return result;
    }
    static String encode(String value){
        try{return URLEncoder.encode(value,"UTF-8").replace("+","%20");}
        catch(java.io.UnsupportedEncodingException impossible){throw new IllegalStateException(impossible);}
    }
}
