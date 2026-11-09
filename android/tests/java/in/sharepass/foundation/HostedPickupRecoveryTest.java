package in.sharepass.foundation;

import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.SSLHandshakeException;

public final class HostedPickupRecoveryTest {
    public static void main(String[] args) throws Exception {
        for (String path : List.of("/api/deposits/test/release", "/api/collections/test/handover")) {
            Set<String> committed = new HashSet<>();
            List<String> sent = new ArrayList<>();
            String savedRequest = "saved-request-id";
            String reply = HostedRegisterClient.retryPickup(path, () -> {
                sent.add(savedRequest);
                if (committed.add(savedRequest)) throw new SocketTimeoutException("Reply lost after commit");
                return "existing handover";
            });
            if (!reply.equals("existing handover") || committed.size() != 1
                    || !sent.equals(List.of(savedRequest, savedRequest))) throw new AssertionError(path);
        }

        AtomicInteger attempts = new AtomicInteger();
        try {
            HostedRegisterClient.retryPickup("/api/deposits/test/release", () -> {
                attempts.incrementAndGet();
                throw new SocketTimeoutException("Still disconnected");
            });
            throw new AssertionError("Disconnection should keep the saved action pending");
        } catch (SocketTimeoutException expected) {
            if (attempts.get() != 2) throw new AssertionError("Expected one bounded retry");
        }
        attempts.set(0);
        try {
            HostedRegisterClient.retryPickup("/api/deposits/test/release", () -> {
                attempts.incrementAndGet();
                throw new SSLHandshakeException("Certificate rejected");
            });
            throw new AssertionError("Certificate failure was not propagated");
        } catch (SSLHandshakeException expected) {
            if (attempts.get() != 1) throw new AssertionError("Certificate failure should not be retried");
        }
        System.out.println("PASS pickup retries one lost reply with the saved ID and preserves manual recovery when offline");
    }
}
