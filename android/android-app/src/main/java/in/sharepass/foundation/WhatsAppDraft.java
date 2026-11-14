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
    static String message(String code,String event,String booth,String location,Map<String,?> counts){
        return message(code,event,booth,location,counts,"");
    }
    static String message(String code,String event,String booth,String location,Map<String,?> counts,String name){
        return message(code,event,booth,location,counts,name,"");
    }
    static String message(String code,String event,String booth,String location,Map<String,?> counts,String name,String reference){
        return message(code,event,booth,location,counts,name,reference,null);
    }
    static String message(String code,String event,String booth,String location,Map<String,?> counts,String name,String reference,Map<String,?> allocation){
        return message(code,event,booth,location,counts,name,reference,allocation,"");
    }
    static String message(String code,String event,String booth,String location,Map<String,?> counts,String name,String reference,Map<String,?> allocation,String origin){
        return message(code,event,booth,location,counts,name,reference,allocation,origin,0);
    }
    static String message(String code,String event,String booth,String location,Map<String,?> counts,String name,String reference,Map<String,?> allocation,String origin,long expiresAt){
        return message(code,event,booth,location,counts,name,reference,allocation,origin,expiresAt,"","");
    }
    static String message(String code,String event,String booth,String location,Map<String,?> counts,String name,String reference,Map<String,?> allocation,String origin,long expiresAt,String depositorName,String staffName){
        // Validate pickup/contact details through the same rules for either message kind.
        validateDetails(code,event,booth,location,name,reference);
        for(String value:new String[]{depositorName,staffName})if(value==null||value.length()>80||value.matches("(?s).*[\\x00-\\x1f\\x7f].*"))throw new IllegalArgumentException("Use valid depositor and staff names");
        String quantities=passCounts(counts);
        if(quantities.isEmpty())throw new IllegalArgumentException("Pass counts required");
        String planned=allocation==null?"":passCounts(allocation);
        if(allocation!=null&&planned.isEmpty())throw new IllegalArgumentException("Review the recipient’s planned share");
        if(!origin.isEmpty()){
            if(expiresAt>0&&expiresAt<=System.currentTimeMillis())throw new IllegalArgumentException("This collection code has expired");
            return "Hi"+(name.trim().isEmpty()?"":" "+name.trim())+"!\nSharePass by Bullseye Entertainment\n\n"+
                (depositorName.isEmpty()?"":"Depositor: "+depositorName+"\n")+(staffName.isEmpty()?"":"Received by: "+staffName+"\n")+
                (event.trim().isEmpty()?"":"Event: "+event.trim()+"\n")+
                (allocation==null?"":"Original plan for you: "+planned+"\n")+"Group balance on this receipt: "+quantities+
                "\nCollection code: "+code+"\nCollect at: "+booth.trim()+(location.trim().isEmpty()?"":", "+location.trim())+"\n"+
                (expiresAt>0?"Code expires: "+expiry(expiresAt)+"\n":"")+"Receipt: "+pickupLink(origin,code,reference)+"\n\n"+
                "Show the current receipt to staff. Shared group code. "+(allocation==null?"Staff confirm availability. ":"Plans are not reservations; staff confirm availability. ")+"Pickups are not tracked by person.";
        }
        return "Hi"+(name.trim().isEmpty()?"":" "+name.trim())+"! "+
            (allocation==null?"The receipt lists "+quantities+" passes for our group.":
                "Your planned share: "+planned+" passes.\nGroup balance on this receipt: "+quantities+" passes.")+
            " SharePass by Bullseye Entertainment.\n\n"+
            (event.trim().isEmpty()?"Use code ":"For "+event.trim()+", use code ")+code+
            (reference.isEmpty()||!origin.isEmpty()?"":" and pickup reference "+reference)+" to collect from "+booth.trim()+
            (location.trim().isEmpty()?"":", "+location.trim())+".\n\n"+
            (reference.isEmpty()||origin.isEmpty()?"":"Receipt: "+pickupLink(origin,code,reference)+"\n\n")+
            "Shared group code. Staff must confirm availability; pickups are not tracked per person.";
    }
    static String expiry(long value){
        java.text.SimpleDateFormat format=new java.text.SimpleDateFormat("d MMM yyyy, h:mm a",java.util.Locale.US);
        format.setTimeZone(java.util.TimeZone.getTimeZone("Asia/Kolkata"));
        return format.format(new java.util.Date(value)).replace("AM","am").replace("PM","pm")+" IST (UTC+05:30)";
    }
    static String pickupLink(String origin,String code,String reference){
        if(!origin.matches("https://[a-z0-9]+(?:[.-][a-z0-9]+)*")||!code.matches("[0-9]{4}")||!reference.matches("PKT-[A-F0-9]{8}"))throw new IllegalArgumentException("Invalid pickup receipt");
        return origin+"/pickup#"+code+"."+reference;
    }
    private static void validateDetails(String code,String event,String booth,String location,String name,String reference){
        if(name==null||name.length()>80||name.matches("(?s).*[\\x00-\\x1f\\x7f].*"))throw new IllegalArgumentException("Use a name of up to 80 characters");
        if(!code.matches("[A-Z0-9]{4}"))throw new IllegalArgumentException("Invalid collection code");
        if(!reference.isEmpty()&&!reference.matches("PKT-[A-F0-9]{8}"))throw new IllegalArgumentException("Invalid pickup reference");
        for(String value:new String[]{event,booth,location})
            if(value==null||value.length()>100||value.matches("(?s).*[\\x00-\\x1f\\x7f].*"))throw new IllegalArgumentException("Invalid pickup details");
        if(booth.trim().isEmpty())throw new IllegalArgumentException("Enter a pickup counter");
    }
    private static String passCounts(Map<String,?> counts){
        if(counts==null||counts.isEmpty())throw new IllegalArgumentException("Pass counts required");
        StringBuilder quantities=new StringBuilder();
        for(Map.Entry<String,?> entry:counts.entrySet()){
            if(entry.getKey()==null||!entry.getKey().matches("[A-Za-z][A-Za-z0-9 _-]{0,39}")||
                !(entry.getValue() instanceof Number))throw new IllegalArgumentException("Invalid pass quantities");
            double value=((Number)entry.getValue()).doubleValue();
            if(!Double.isFinite(value)||value<0||value>10000||value!=Math.floor(value))throw new IllegalArgumentException("Invalid pass quantities");
            int count=(int)value;
            if(count==0)continue;
            if(quantities.length()>0)quantities.append(" + ");
            String label=entry.getKey().equals("normal")?"Normal":entry.getKey().matches("vip|vvip|mip")?entry.getKey().toUpperCase(java.util.Locale.ROOT):entry.getKey();
            quantities.append(count).append(" ").append(label);
        }
        return quantities.toString();
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
