package in.sharepass.foundation;

import org.json.JSONArray;
import org.json.JSONObject;

final class QueueSummary {
    static String body(JSONArray drafts,JSONArray messages){
        StringBuilder text=new StringBuilder();
        for(int i=0;i<Math.min(3,drafts.length());i++){
            JSONObject draft=drafts.optJSONObject(i);if(draft==null)continue;
            if(text.length()>0)text.append("; ");
            String name=draft.optString("name","Depositor");text.append(name.substring(0,Math.min(80,name.length())));
            JSONObject counts=draft.optJSONObject("quantities");
            if(counts!=null)for(String key:new String[]{"normal","vip","vvip","mip"})if(counts.optInt(key)>0)
                text.append(" · ").append(counts.optInt(key)).append(" ").append("normal".equals(key)?"Normal":"vip".equals(key)?"VIP":"vvip".equals(key)?"VVIP":"MIP");
        }
        if(drafts.length()>3)text.append(" · +").append(drafts.length()-3).append(" more");
        if(messages!=null&&messages.length()>0){
            JSONObject message=messages.optJSONObject(0);
            if(message!=null){if(text.length()>0)text.append("; ");String value=message.optString("message","New staff message");text.append("Admin: ").append(value.substring(0,Math.min(160,value.length())));}
        }
        return text.toString();
    }
}
