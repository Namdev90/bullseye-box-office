package in.sharepass.foundation;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public final class PickupScanTest {
    private static void check(String input, String code, String reference) {
        var actual = PickupScan.parse(input);
        if (!actual.code().equals(code) || !actual.reference().equals(reference)) throw new AssertionError(input);
    }
    private static void reject(String input) {
        try { PickupScan.parse(input); }
        catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("Accepted invalid or ambiguous scanned input: " + input);
    }
    public static void main(String[] args) {
        check("0069", "0069", "");
        check(" 4200 ", "4200", "");
        String message = "Hi! SharePass by Bullseye Entertainment. For Demo, use code 0069 and pickup reference PKT-1234ABCD to collect.";
        check(message, "0069", "PKT-1234ABCD");
        check("https://wa.me/919876543210?text=" + URLEncoder.encode(message, StandardCharsets.UTF_8), "0069", "PKT-1234ABCD");
        check("SharePass pickup code: 4200", "4200", "");
        String origin="https://sharepass.example.test",link=WhatsAppDraft.pickupLink(origin,"0069","PKT-1234ABCD");
        var receipt=PickupScan.parse(link,origin);
        if(!receipt.code().equals("0069")||!receipt.reference().equals("PKT-1234ABCD"))throw new AssertionError("Receipt identity missing");
        var shared=PickupScan.parse("SharePass use code 0069.\nReceipt: "+link,origin);
        if(!shared.equals(receipt))throw new AssertionError("Shared receipt differs");
        for(String bad:new String[]{link.replace(origin,"https://evil.example"),link+".other",link.replace("0069","4200")}){
            try{PickupScan.parse("SharePass use code 0069.\nReceipt: "+bad,origin);throw new AssertionError("Accepted mismatched receipt");}
            catch(IllegalArgumentException expected){}
        }
        for (String invalid : new String[]{null, "", "069", "00690", "12a4", "PKT-1234ABCD", "use code 0069", "SharePass code 0069",
            "https://evil.example/?text=" + URLEncoder.encode(message, StandardCharsets.UTF_8),
            "https://wa.me@evil.example/?text=" + URLEncoder.encode(message, StandardCharsets.UTF_8),
            "https://user@wa.me/?text=" + URLEncoder.encode(message, StandardCharsets.UTF_8),
            "https://wa.me:443/?text=" + URLEncoder.encode(message, StandardCharsets.UTF_8),
            "https://wa.me/?text=" + URLEncoder.encode(message, StandardCharsets.UTF_8) + "&text=other",
            "SharePass use code 00690", "SharePass use code 0069 and pickup code 4200",
            "SharePass use code 0069 pickup reference PKT-1234ABCD pickup reference PKT-1234ABCD", "x".repeat(6001)}) reject(invalid);
        System.out.println("PASS pickup scanner accepts exact numeric codes and SharePass WhatsApp drafts, rejects unrelated or ambiguous input");
    }
}
