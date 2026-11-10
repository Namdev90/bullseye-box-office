package in.sharepass.foundation;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

public final class RecipientAllocationDraftTest {
    private static String message(Map<String,?> remaining, Map<String,?> allocation) {
        return WhatsAppDraft.message("K7M4", "", "Box office", "", remaining, "Fixture", "PKT-1234ABCD", allocation);
    }
    public static void main(String[] args) {
        Map<String,Integer> remaining = new LinkedHashMap<>();
        remaining.put("normal", 1); remaining.put("vip", 0);
        Map<String,Integer> allocation = new LinkedHashMap<>();
        allocation.put("normal", 3); allocation.put("vip", 2);
        String planned = message(remaining, allocation);
        String expected = "Hi Fixture! Your planned share: 3 Normal + 2 VIP passes.\nGroup balance on this receipt: 1 Normal passes. SharePass by Bullseye Entertainment.\n\n" +
            "Use code K7M4 and pickup reference PKT-1234ABCD to collect from Box office.\n\n" +
            "Shared group code. Staff must confirm availability; pickups are not tracked per person.";
        if (!planned.equals(expected)) throw new AssertionError(planned);
        String second = message(remaining, Map.of("mip", 2));
        if (!second.contains("Your planned share: 2 MIP passes.") || !second.contains("Group balance on this receipt: 1 Normal passes.")) throw new AssertionError(second);
        if (!allocation.equals(Map.of("normal", 3, "vip", 2)) || !remaining.equals(Map.of("normal", 1, "vip", 0))) throw new AssertionError("Counts changed");
        String legacy = message(remaining, null);
        if (legacy.contains("Your planned share") || !legacy.contains("1 Normal passes for our group")) throw new AssertionError(legacy);
        if (!legacy.equals(WhatsAppDraft.message("K7M4", "", "Box office", "", remaining, "Fixture", "PKT-1234ABCD"))) throw new AssertionError("Legacy overload differs");
        String url = WhatsAppDraft.url("+12025550101", planned);
        if (!url.startsWith("https://wa.me/12025550101?text=") || !URLDecoder.decode(url.substring(url.indexOf('=') + 1), StandardCharsets.UTF_8).equals(planned)) throw new AssertionError(url);
        for (Object bad : new Object[]{-1, 1.5, "2", 10001, Double.NaN, Double.POSITIVE_INFINITY, Boolean.TRUE}) {
            reject(remaining, Map.of("normal", bad));
            reject(Map.of("normal", bad), allocation);
        }
        Map<String,Object> nullCount = new LinkedHashMap<>(); nullCount.put("normal", null);
        reject(remaining, nullCount); reject(remaining, Map.of()); reject(remaining, Map.of("normal", 0));
        reject(Map.of("normal", 0), allocation);
        System.out.println("PASS native planned allocations, partial/group balances, legacy contacts, strict validation and URL round-trip");
    }
    private static void reject(Map<String,?> remaining, Map<String,?> allocation) {
        try { message(remaining, allocation); throw new AssertionError("Invalid quantities accepted"); }
        catch (IllegalArgumentException expected) { }
    }
}
