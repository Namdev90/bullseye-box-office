package in.sharepass.foundation;

public final class HostedPairingTest {
    public static void main(String[] args) throws Exception {
        String invite = "4ac2bab5-2688-4782-b453-d70c9dc6ddfd";
        String query = "?invite=" + invite;
        if (!invite.equals(HostedRegisterClient.setupInvite(HostedRegisterClient.ORIGIN + "/connect" + query))
                || !invite.equals(HostedRegisterClient.setupInvite(HostedRegisterClient.ORIGIN + "/app-setup" + query))
                || !invite.equals(HostedRegisterClient.setupInvite("sharepass://connect" + query))
                || !HostedRegisterClient.setupInvite("https://example.test/connect" + query).isEmpty()
                || !HostedRegisterClient.setupInvite("https://example.test/app-setup" + query).isEmpty()
                || !HostedRegisterClient.setupInvite(HostedRegisterClient.ORIGIN + "/app-setup/" + query).isEmpty()
                || !HostedRegisterClient.setupInvite(HostedRegisterClient.ORIGIN + "/app-setup" + query + "#other").isEmpty()
                || !HostedRegisterClient.setupInvite(HostedRegisterClient.ORIGIN + "/app-setup?%69nvite=" + invite).isEmpty()
                || !HostedRegisterClient.setupInvite(HostedRegisterClient.ORIGIN + "/app-setup" + query + "&invite=other").isEmpty()
                || !HostedRegisterClient.setupInvite("sharepass://connect" + query + "&invite=other").isEmpty()) {
            throw new AssertionError("Only SharePass setup links with one invite are allowed.");
        }
        System.out.println("PASS native pairing link is constrained to the SharePass setup endpoint");
    }
}
