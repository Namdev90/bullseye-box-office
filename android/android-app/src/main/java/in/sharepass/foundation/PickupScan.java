package in.sharepass.foundation;

import java.net.URI;
import java.net.URLDecoder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Converts only pickup values or known SharePass WhatsApp drafts into lookup inputs. */
final class PickupScan {
    record Details(String code, String reference) {}
    private static final Pattern CODE = Pattern.compile("(?i)\\b(?:use|collection|pickup) code\\s*:?\\s*([0-9]{4})(?![0-9])");
    private static final Pattern REFERENCE = Pattern.compile("(?i)\\bpickup reference\\s*:?\\s*(PKT-[A-F0-9]{8})(?![A-F0-9])");

    private static String decode(String value) {
        try { return URLDecoder.decode(value, "UTF-8"); }
        catch (java.io.UnsupportedEncodingException impossible) { throw new IllegalStateException(impossible); }
    }

    static Details parse(String value) {
        return parse(value,"");
    }
    private static Details receipt(String value,String origin){
        URI url=URI.create(value);
        if(origin.isEmpty()||!value.startsWith(origin+"/pickup#")||!"/pickup".equals(url.getRawPath())||url.getRawQuery()!=null||url.getUserInfo()!=null)throw new IllegalArgumentException("Invalid pickup receipt");
        String[] parts=url.getRawFragment().split("\\.",-1);
        if(parts.length!=2||!parts[0].matches("[0-9]{4}")||!parts[1].matches("PKT-[A-F0-9]{8}"))throw new IllegalArgumentException("Invalid pickup receipt");
        return new Details(parts[0],parts[1]);
    }
    static Details parse(String value,String origin) {
        if (value == null || value.length() > 6000) throw new IllegalArgumentException("Invalid pickup QR");
        String text = value.trim();
        if (text.matches("[0-9]{4}")) return new Details(text, "");
        if(!origin.isEmpty()&&text.startsWith(origin+"/pickup#"))return receipt(text,origin);
        if (text.startsWith("https://")) {
            URI link;
            try { link = URI.create(text); } catch (IllegalArgumentException invalid) { throw new IllegalArgumentException("Invalid pickup QR"); }
            if (!"wa.me".equals(link.getHost()) || link.getUserInfo() != null || link.getPort() != -1
                    || link.getFragment() != null || link.getRawQuery() == null) throw new IllegalArgumentException("Invalid pickup QR");
            String message = null;
            for (String part : link.getRawQuery().split("&")) {
                if (!part.startsWith("text=")) continue;
                if (message != null) throw new IllegalArgumentException("Ambiguous pickup QR");
                message = decode(part.substring(5));
            }
            if (message == null) throw new IllegalArgumentException("Invalid pickup QR");
            text = message;
        }
        if (!text.contains("SharePass")) throw new IllegalArgumentException("Invalid pickup QR");
        Matcher code = CODE.matcher(text);
        if (!code.find()) throw new IllegalArgumentException("Missing pickup code");
        String found = code.group(1);
        if (code.find()) throw new IllegalArgumentException("Ambiguous pickup code");
        Matcher reference = REFERENCE.matcher(text);
        String packet = reference.find() ? reference.group(1).toUpperCase(java.util.Locale.ROOT) : "";
        if (reference.find()) throw new IllegalArgumentException("Ambiguous pickup reference");
        Matcher link=Pattern.compile("https://[^\\s]+/pickup#[^\\s]+").matcher(text);
        if(link.find()){
            Details current=receipt(link.group(),origin);
            if(!current.code().equals(found)||!packet.isEmpty()&&!packet.equals(current.reference())||link.find())throw new IllegalArgumentException("Ambiguous pickup receipt");
            packet=current.reference();
        }
        return new Details(found, packet);
    }
}
