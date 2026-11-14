package in.sharepass.foundation;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputFilter;
import android.text.InputType;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.view.MotionEvent;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.CheckBox;
import android.speech.tts.TextToSpeech;
import android.widget.EditText;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Predicate;

public final class HostedDeskActivity extends Activity {
    private HoldButton handoverHold;
    private static final String[] KEYS = {"normal", "vip", "vvip", "mip"};
    private static final String[] LABELS = {"Normal", "VIP", "VVIP", "MIP"};
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService polling = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable intakePoll = this::checkIntake;
    private final Runnable queuePoll = this::checkQueue;
    private final Runnable slowAction = () -> note("Working…");
    private final HashSet<String> seenQueue = new HashSet<>();
    private final HashSet<String> seenStaffMessages = new HashSet<>();
    private JSONArray staffMessages = new JSONArray();
    private Button staffMessageButton;
    private AlertDialog staffMessageDialog;
    private HostedRegisterClient client;
    private TextToSpeech speech;
    private boolean speechReady;
    private JSONObject context;
    private LinearLayout content;
    private LinearLayout deskNavigation;
    private DeskWindow viewport;
    private AppUpdates updates;
    private TextView status;
    private android.widget.Toast feedbackToast;
    private WebView qr;
    private Runnable back;
    private String intakeToken;
    private boolean busy, foreground, checkingIntake;
    private boolean checkingQueue, queueBaseline, requestedQueue;
    private Button queueButton;
    private LinearLayout queueRows;
    private JSONArray queueDrafts = new JSONArray();
    private String queueSnapshot = "";
    private String screen;
    private int deskPane;
    private boolean manualQueueRefresh;
    private LinearLayout historyRows;
    private final HashSet<String> historySeenIds = new HashSet<>();
    private String historyCursor;
    private boolean historyOnlyPending;
    private JSONObject historySnapshot;
    private String historySession="";
    private com.journeyapps.barcodescanner.DecoratedBarcodeView scanner;
    private boolean scanningSetup;
    private String scannerSession = "";
    private static final int SETUP_PERMISSIONS = 222;
    private static final int CAMERA_SCAN = 223;
    private String deskCode = "";
    private EditText deskInput;
    private Button retryLookup;
    private float deskTouchX, deskTouchY;
    private boolean deskSwipeStarted;
    private final ArrayList<Recipient> recipients = new ArrayList<>();
    private String sharingCode, sharingPacket;

    private static final class Recipient {
        String name = "", phone = "";
        String rawName, rawPhone;
        Object quantities; // Absent means a group contact; JSON null remains invalid, not absent.
    }

    private interface Work { JSONObject run() throws Exception; }
    private interface Done { void accept(JSONObject value) throws Exception; }
    private interface Step { void show(Runnable previous, Runnable next); }
    private interface SaveText { String save(String value, boolean validate); }

    private final class Wizard {
        final ArrayList<Step> steps = new ArrayList<>();
        final Runnable exit, complete;
        Wizard(Runnable exit, Runnable complete) { this.exit = exit; this.complete = complete; }
        void start() { show(0); }
        void show(int index) {
            if (index == steps.size()) { complete.run(); return; }
            steps.get(index).show(index == 0 ? exit : () -> show(index - 1), () -> show(index + 1));
        }
        void review(String title, String value, String label) {
            steps.add((previous, next) -> {
                page(title, "review-step", previous);
                line(value, 20, true);
                button(label, next, true);
            });
        }
        void text(String title, String initial, int type, int limit, String hint, SaveText save, Map<String, String> shortcuts, Predicate<String> advanceWhenReady) {
            String[] draft = {initial};
            steps.add((previous, next) -> {
                EditText[] input = new EditText[1];
                page(title, "text-step", () -> {
                    draft[0] = input[0].getText().toString();
                    save.save(draft[0].trim(), false);
                    previous.run();
                });
                input[0] = textInput(type, limit);
                input[0].setContentDescription(title);
                input[0].setHint(hint);
                input[0].setText(draft[0]);
                content.addView(input[0]);
                Runnable advance = () -> {
                    draft[0] = input[0].getText().toString();
                    String error = save.save(draft[0].trim(), true);
                    if (error == null) next.run();
                    else input[0].setError(error);
                };
                shortcuts.forEach((label, value) -> button(label, () -> {
                    input[0].setText(value);
                    advance.run();
                }, false));
                button(advanceWhenReady==null?"Continue":"Check packet label", advance, true);
                if(advanceWhenReady!=null)autoAdvance(input[0],advanceWhenReady,advance);
            });
        }
        void text(String title, String initial, int type, int limit, String hint, SaveText save) {
            text(title, initial, type, limit, hint, save, Collections.emptyMap(), null);
        }
        void text(String title, String initial, int type, int limit, String hint, SaveText save, Map<String, String> shortcuts) {
            text(title, initial, type, limit, hint, save, shortcuts, null);
        }
    }

    private static final class DepositDraft {
        String shelf = "", code = "";
        int minutes;
        int[] quantities;
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        speech=new TextToSpeech(this, result->{speechReady=result==TextToSpeech.SUCCESS;});
        updates = new AppUpdates(this, this::updateIdle);
        requestedQueue = getIntent().getBooleanExtra("openBoothQueue", false);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
            android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        page("SharePass", "opening", this::finish);
        String invite = getIntent().getStringExtra("setupInvite");
        run(() -> {
            client = new HostedRegisterClient(this);
            if (invite != null && !client.hasPending() && client.handover() == null) return null;
            return client.token().isEmpty() ? null : client.context();
        }, value -> {
            if (invite != null && !client.hasPending() && client.handover() == null) pairingInvite(invite);
            else if (value == null) login();
            else signedIn(value);
        });
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        QueuePush.counterVisible(true);
        QueuePush.listen(() -> handler.post(() -> {historySnapshot=null;scheduleQueue(0);}));
        if (context != null && !context.optString("staff_label", "").isEmpty() && !context.isNull("staff_label")) {
            QueuePush.sync(this, client.token());
        }
        scheduleIntake(0);
        scheduleQueue(0);
        reportDeviceStatus();
        if (scanner != null && checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) scanner.resume();
        updates.start();
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String invite = intent.getStringExtra("setupInvite");
        if (invite != null) {
            if (client == null || busy || client.hasPending() || client.handover() != null
                    || !("desk".equals(screen) || "login".equals(screen) || "pair-link".equals(screen) || "pair-invite".equals(screen))) {
                note("Finish or leave the current step before using a new setup QR.");
            } else pairingInvite(invite);
            return;
        }
        requestedQueue = intent.getBooleanExtra("openBoothQueue", false);
        scheduleQueue(0);
    }
    @Override protected void onPause() {
        if(handoverHold!=null)handoverHold.cancel();
        DeskSounds.stop();
        foreground = false;
        if(feedbackToast!=null)feedbackToast.cancel();
        if(speech!=null)speech.stop();
        if (scanner != null) scanner.pause();
        if (staffMessageDialog != null) staffMessageDialog.dismiss();
        updates.stop();
        QueuePush.counterVisible(false);
        QueuePush.listen(null);
        handler.removeCallbacks(intakePoll);
        handler.removeCallbacks(queuePoll);
        super.onPause();
    }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if(!focused&&handoverHold!=null)handoverHold.cancel();
        if (updates == null) return;
        updates.focusChanged(focused);
        if (focused) updates.offerSetup();
    }
    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        releaseQr();
        worker.shutdown();
        polling.shutdown();
        if(speech!=null){speech.stop();speech.shutdown();}
        super.onDestroy();
    }
    @android.annotation.SuppressLint("GestureBackNavigation")
    @SuppressWarnings("deprecation") @Override public void onBackPressed() { goBack(); }
    private void goBack() { if (!busy && back != null) back.run(); }

    private String boothLabel() {
        return context == null || context.isNull("booth_label") ? "" : context.optString("booth_label").trim();
    }
    private int dp(int value) { return DeskSurface.dp(this, value); }
    private void releaseQr() {
        if (qr == null) return;
        if (qr.getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup) qr.getParent()).removeView(qr);
        qr.destroy();
        qr = null;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    private void page(String title, String name, Runnable goBack) {
        if(handoverHold!=null){handoverHold.cancel();handoverHold=null;}
        if (deskInput != null) deskCode = deskInput.getText().toString();
        View focused = getCurrentFocus();
        if (focused instanceof EditText) {
            getSystemService(android.view.inputmethod.InputMethodManager.class)
                .hideSoftInputFromWindow(focused.getWindowToken(), 0);
            focused.clearFocus();
        }
        releaseQr();
        if (scanner != null) { scanner.pause(); scanner = null; }
        handler.removeCallbacks(intakePoll);
        screen = name;
        deskInput = null;
        retryLookup = null;
        back = goBack;
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        queueButton = null;
        staffMessageButton = null;
        queueRows = null;
        historyRows = null;
        content = new LinearLayout(this);
        deskNavigation=null;
        content.setOrientation(LinearLayout.VERTICAL);
        int sidePadding = dp(16);
        content.setPadding(sidePadding, dp(12), sidePadding, dp(24));
        scroll.addView(content);
        if (viewport == null) {
            viewport = new DeskWindow(this);
            setContentView(viewport);
        }

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(16),dp(4),dp(16),dp(10));
        if (goBack != null&&!"desk".equals(name)) {
            Button previous = new Button(this);
            previous.setText("‹");
            previous.setContentDescription("Back");
            DeskSurface.roundButton(previous);
            previous.setOnClickListener(view -> goBack());
            toolbar.addView(previous, new LinearLayout.LayoutParams(dp(48), dp(48)));
        }
        TextView label = new TextView(this);
        String booth = boothLabel();
        String staffName=context==null?"":context.optString("staff_label","");
        label.setText(booth.isEmpty()?"SharePass":booth+(staffName.isEmpty()?"":" · "+staffName));
        label.setTextColor(DeskSurface.MUTED);
        label.setTextSize(12);
        label.setMaxLines(2);
        label.setEllipsize(android.text.TextUtils.TruncateAt.END);
        label.setTypeface(Typeface.DEFAULT_BOLD);
        label.setLetterSpacing(.02f);
        label.setPadding(goBack == null ? 0 : dp(12), 0, dp(12), 0);
        int labelIndex = toolbar.getChildCount();
        toolbar.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
        View spacer = new View(this);
        spacer.setVisibility(View.GONE);
        toolbar.addView(spacer, new LinearLayout.LayoutParams(0, 0, 1));
        if ("desk".equals(name)) {
            Button account = new Button(this);
            account.setText("↪");
            account.setContentDescription("Log out");
            DeskSurface.roundButton(account);
            account.setOnClickListener(view -> logout());
            Button refresh=new Button(this);refresh.setText("↻");refresh.setContentDescription("Refresh SharePass");DeskSurface.roundButton(refresh);
            refresh.setOnClickListener(view -> refreshQueueNow());toolbar.addView(refresh,toolbarBounds());
            toolbar.addView(account,toolbarBounds());
            staffMessageButton=new Button(this);DeskSurface.roundButton(staffMessageButton);
            staffMessageButton.setOnClickListener(view->showStaffMessage(true));toolbar.addView(staffMessageButton,toolbarBounds());
            updateStaffMessageButton();
        }
        if (!"opening".equals(name)) {
            Button help = new Button(this);
            help.setText("?");
            help.setContentDescription("Help for " + title);
            DeskSurface.roundButton(help);
            help.setOnClickListener(view -> new AlertDialog.Builder(this).setTitle(title)
                .setMessage(helpText(title, name)).setPositiveButton("Got it", null)
                .setNeutralButton("Notifications",(dialog,which)->openAlertSettings())
                .setNegativeButton(DeskSounds.enabled(this)?"Mute sounds":"Enable sounds",(dialog,which)->{DeskSounds.toggle(this);note(DeskSounds.enabled(this)?"Sounds on.":"Sounds muted.");}).show());
            toolbar.addView(help,toolbarBounds());
        }
        header.addView(toolbar, new LinearLayout.LayoutParams(-1, -2));
        header.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            boolean stacked = right - left < dp(260) || getResources().getConfiguration().fontScale > 1.3f;
            if (stacked && label.getParent() == toolbar) {
                toolbar.removeView(label);
                spacer.setVisibility(View.VISIBLE);
                label.setPadding(0, 0, 0, dp(8));
                header.addView(label, 0, new LinearLayout.LayoutParams(-1, -2));
            } else if (!stacked && label.getParent() == header) {
                header.removeView(label);
                spacer.setVisibility(View.GONE);
                label.setPadding(goBack == null ? 0 : dp(12), 0, dp(12), 0);
                toolbar.addView(label, labelIndex, new LinearLayout.LayoutParams(0, -2, 1));
            }
        });
        BrandArtwork brand = new BrandArtwork(this, true);
        LinearLayout frame=new LinearLayout(this);frame.setOrientation(LinearLayout.VERTICAL);
        frame.addView(brand,new LinearLayout.LayoutParams(-1,dp(64)));
        frame.addView(header);
        if("desk".equals(name)){deskNavigation=new LinearLayout(this);deskNavigation.setPadding(dp(16),dp(8),dp(16),dp(8));frame.addView(deskNavigation);}
        frame.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));viewport.show(frame,680);
        TextView heading = line(title, 30, true);
        heading.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        if (Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true);
        if (!name.equals("share-qr") && !name.equals("opening") && Build.VERSION.SDK_INT >= 26
                && android.animation.ValueAnimator.areAnimatorsEnabled()) {
            heading.setTranslationY(dp(6));
            heading.setAlpha(.72f);
            heading.animate().translationY(0).alpha(1f).setDuration(170).start();
        }
        status = line("", 15, false);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        status.setVisibility(View.GONE);
        if(!"desk".equals(name)&&!"opening".equals(name)&&!"scanner".equals(name)&&!"share-qr".equals(name))beginCard();
    }
    private LinearLayout.LayoutParams toolbarBounds(){
        LinearLayout.LayoutParams bounds=new LinearLayout.LayoutParams(dp(44),dp(48));bounds.leftMargin=dp(6);return bounds;
    }
    private void beginCard(){
        LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(DeskSurface.panel(this));card.setPadding(dp(16),dp(12),dp(16),dp(16));
        LinearLayout.LayoutParams bounds=new LinearLayout.LayoutParams(-1,-2);bounds.topMargin=dp(12);
        content.addView(card,bounds);content=card;
    }
    private static String helpText(String title, String screen) {
        return switch (title) {
            case "Connect this phone", "Connect with a QR link", "Use this setup QR" ->
                "Ask your supervisor for a new setup code or QR if yours has expired or already been used.";
            case "Pass desk" -> "Open the booth queue for waiting deposits, or look up a collection code under Collect passes.";
            case "Booth poster QR" -> "Print this QR once for your booth. People can scan it and enter their details while they wait.";
            case "Booth queue", "Check customer name" -> "Match the waiting person's name and queue reference before checking their passes.";
            case "Check pass counts", "Check available passes" -> "Compare the counts for each type with the passes in front of you.";
            case "Shelf or slot", "Find the packet" -> "Use the physical shelf or slot label so staff can find the right packet.";
            case "Custom code (optional)" -> "Use four digits. Leave it blank to let SharePass choose an available code.";
            case "Code lifetime (optional)" -> "Choose between 5 minutes and 2 days. Leave it blank for the register's default.";
            case "Confirm receipt" -> "Confirm after the customer's physical passes are in your hands.";
            case "Collect passes" -> "Enter the four digits on the pickup receipt. Looking up the code does not release passes.";
            case "Prepare pickup", "Hand over passes" -> "Check the physical passes and counts before confirming the handover.";
            case "Passes deposited", "WhatsApp recipient", "Share by WhatsApp" -> "Show the code or a share QR. Each message is a draft the sender can review.";
            default -> "share-qr".equals(screen)
                ? "Ask the recipient to scan the WhatsApp QR, then review the draft."
                : "Use Back to review the previous step. Your next action appears below.";
        };
    }
    private TextView line(String value, int size, boolean bold) {
        TextView text = new TextView(this);
        text.setTextColor(bold ? DeskSurface.INK : DeskSurface.MUTED);
        text.setTextSize(size);
        if (bold) text.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        text.setPadding(0, dp(9), 0, dp(9));
        text.setText(value);
        content.addView(text);
        return text;
    }
    private Button button(String label, Runnable action, boolean primary) {
        Button button = new Button(this);
        button.setText(label);
        DeskSurface.button(button, primary);
        LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(-1, -2);
        size.topMargin = dp(12);
        size.bottomMargin = dp(3);
        content.addView(button, size);
        button.setOnClickListener(view -> { if (!busy) action.run(); });
        return button;
    }
    private Button messageButton(String name,Runnable action){
        return button(name==null||name.trim().isEmpty()?"Message on WhatsApp":"Message — "+name.trim(),action,false);
    }
    private EditText field(String label, int input, int limit) {
        TextView caption = line(label, 15, true);
        EditText edit = textInput(input, limit);
        caption.setLabelFor(edit.getId());
        content.addView(edit);
        return edit;
    }
    private EditText textInput(int input, int limit) {
        EditText edit = new EditText(this);
        edit.setId(View.generateViewId());
        edit.setInputType(input);
        if (Build.VERSION.SDK_INT >= 26) edit.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        edit.setSingleLine(true);
        edit.setFilters(new InputFilter[]{new InputFilter.LengthFilter(limit)});
        edit.setTextColor(DeskSurface.INK);
        edit.setMinHeight(dp(52));
        edit.setPadding(dp(12), dp(8), dp(12), dp(8));
        edit.setBackground(DeskSurface.input(this));
        return edit;
    }
    private void autoAdvance(EditText field, Predicate<String> ready, Runnable advance) {
        Runnable step = () -> {
            if (foreground && !busy && field.isAttachedToWindow()
                    && ready.test(field.getText().toString())) advance.run();
        };
        field.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) {
                handler.removeCallbacks(step);
                if (ready.test(value.toString())) handler.postDelayed(step, 420);
            }
            @Override public void afterTextChanged(Editable value) {}
        });
        field.setOnFocusChangeListener((view, focused) -> {
            if (!focused) handler.removeCallbacks(step);
        });
    }
    private void note(String message) {
        status.setText(message);
        status.setVisibility(message.isEmpty() ? View.GONE : View.VISIBLE);
        if(feedbackToast!=null)feedbackToast.cancel();
        android.view.accessibility.AccessibilityManager access=getSystemService(android.view.accessibility.AccessibilityManager.class);
        if(foreground&&!message.isEmpty()&&!message.equals("Working…")&&!message.equals("Connecting…")
                &&(access==null||!access.isTouchExplorationEnabled())){
            feedbackToast=android.widget.Toast.makeText(this,message,android.widget.Toast.LENGTH_LONG);
            feedbackToast.show();
            DeskSounds.play(this,message.equals("Handover confirmed.")||message.equals("Passes received. Collection code ready.")?"confirm":"alert");
        }
    }
    private void failed(Exception error) {
        if (error instanceof HostedRegisterClient.Rejected && ((HostedRegisterClient.Rejected) error).status == 401
                && client != null && !client.token().isEmpty()) {
            try {
                client.forgetExpiredSession();
                clearQueue();
                login();
                note("Enter a new setup code to reconnect this phone.");
            } catch (Exception storage) { note("This phone could not save its session. Reopen SharePass."); }
            return;
        }
        String message = error instanceof IOException && !(error instanceof HostedRegisterClient.Rejected)
            ? "Could not reach the register. Check your connection and try again."
            : error.getMessage();
        if (client != null && client.hasPending()) {
            desk();
            message = "The last action needs to be checked. Use Recover last action before continuing.";
        }
        if(error instanceof HostedRegisterClient.ReconciliationRequired)message=error.getMessage();
        note(message == null || message.isEmpty() ? "SharePass could not finish this action." : message);
        if (retryLookup != null && deskInput != null && deskInput.length() == 4) retryLookup.setVisibility(View.VISIBLE);
    }
    private void run(Work action, Done done) {
        if (busy) return;
        updates.cancelDownload();
        busy = true;
        note("");
        handler.postDelayed(slowAction, 350);
        worker.execute(() -> {
            try {
                JSONObject result = action.run();
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    handler.removeCallbacks(slowAction);
                    busy = false;
                    note("");
                    try { done.accept(result); } catch (Exception error) { failed(error); }
                    scheduleQueue(requestedQueue ? 0 : 3500);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    handler.removeCallbacks(slowAction);
                    busy = false;
                    failed(error);
                    scheduleQueue(requestedQueue ? 0 : 3500);
                });
            }
        });
    }
    private void login() {
        page("Connect this phone", "login", this::finish);
        line("Enter the four-digit setup code provided by your supervisor.", 17, false);
        EditText input = field("Setup code", InputType.TYPE_CLASS_NUMBER, 4);
        button("Connect", () -> {
            String value = input.getText().toString().trim();
            if (!value.matches("[0-9]{4}")) { input.setError("Enter four digits"); return; }
            run(() -> client.connectDevice("code", value), this::connected);
        }, true);
        button("Scan setup QR", () -> scanQr(true), false);
        button("Paste setup link", this::pairingLink, false);
        button("Admin login", this::openAdminAccount, false);
    }
    private void pairingLink() {
        page("Connect with a QR link", "pair-link", this::login);
        line("Scan the setup QR with your camera, then copy and paste the link here.", 17, false);
        EditText input = field("Setup QR link", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI, 512);
        button("Connect", () -> {
            String invite = HostedRegisterClient.setupInvite(input.getText().toString().trim());
            if (invite.isEmpty()) { input.setError("Paste the SharePass setup link"); return; }
            run(() -> client.connectDevice("invite", invite), this::connected);
        }, true);
    }
    private void pairingInvite(String invite) {
        page("Use this setup QR", "pair-invite", () -> {
            if (client.token().isEmpty()) login();
            else run(client::context, this::signedIn);
        });
        button("Retry connection", () -> run(() -> client.connectDevice("invite", invite), this::connected), true);
        handler.post(()->run(()->client.connectDevice("invite",invite),this::connected));
    }
    private void connected(JSONObject result) {
        clearQueue();
        signedIn(result);
    }
    private void signedIn(JSONObject result) {
        context = result;
        if (result.optString("staff_label", "").isEmpty() || result.isNull("staff_label")) profile();
        else {
            desk();
            scheduleQueue(0);
            QueuePush.sync(this, client.token());
            requestSetupPermissions();
            reportDeviceStatus();
            if (foreground) {
                updates.offerSetup();
                updates.start();
            }
        }
    }
    private void profile() {
        page("Your staff profile", "profile", null);
        EditText name = field("Your name", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS, 80);
        if (Build.VERSION.SDK_INT >= 26) {
            name.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
            name.setAutofillHints(View.AUTOFILL_HINT_NAME);
        }
        button("Continue", () -> {
            String value = name.getText().toString().trim();
            if (value.isEmpty()) { name.setError("Enter your name"); return; }
            run(() -> client.request("/api/profile", new JSONObject().put("name", value)), this::signedIn);
        }, true);
    }
    private void desk(String code) {
        deskPane = 1;
        deskCode = code;
        desk();
    }
    private void desk() {
        recipients.clear();
        sharingCode = null;
        page(deskPane==2?"History":"Pass desk", "desk", this::finish);
        if (client.hasPending()) {
            button("Recover last action", () -> run(client::recover, this::stockResult), true);
            return;
        }
        if (client.handover() != null && client.handover().optBoolean("finalize_confirmed")) {
            button("Recover confirmed handover",()->run(client::completeConfirmedHandover,this::stockResult),true);return;
        }
        if (client.handover() != null) {
            button("Resume handover", () -> handover(client.handover()), true);
            return;
        }
        GridLayout tabs=new GridLayout(this);tabs.setColumnCount(3);
        for (int index = 0; index < 3; index++) {
            final int selected = index;
            Button tab = new Button(this);
            tab.setText(new String[]{"Deposit", "Collect", "History"}[index]);
            tab.setSingleLine(true);
            tab.setSelected(deskPane == index);
            DeskSurface.button(tab, false);
            tabs.addView(tab,tabBounds(index,3));
            tab.setOnClickListener(view -> switchDeskPane(selected));
        }
        tabs.addOnLayoutChangeListener((view,left,top,right,bottom,oldLeft,oldTop,oldRight,oldBottom)->{
            float labelWidth=0;for(int i=0;i<tabs.getChildCount();i++){Button tab=(Button)tabs.getChildAt(i);labelWidth=Math.max(labelWidth,tab.getPaint().measureText(tab.getText().toString()));}
            int columns=DeskGeometry.keypadColumns(right-left+dp(8),(int)Math.ceil(labelWidth)+dp(32),3);
            if(tabs.getColumnCount()==columns)return;
            tabs.setColumnCount(GridLayout.UNDEFINED);
            for(int i=0;i<tabs.getChildCount();i++)tabs.getChildAt(i).setLayoutParams(tabBounds(i,columns));
            tabs.setColumnCount(columns);
        });
        deskNavigation.addView(tabs,new LinearLayout.LayoutParams(-1,-2));
        addStaffMessageButton();
        if (deskPane == 1) {
            beginCard();
            line("Collect passes", 20, true);
            collectionEntry(deskCode);
        } else if (deskPane == 2) {
            line("Recent deposits and handovers for this booth.", 16, false);
            LinearLayout filters=new LinearLayout(this);
            boolean largeFilters=getResources().getConfiguration().fontScale>1.3f;
            for(boolean pendingOnly:new boolean[]{false,true}){
                Button filter=new Button(this);filter.setText(pendingOnly?"Pending":largeFilters?"All":"All deposits");filter.setContentDescription(pendingOnly?"Show pending handovers":"Show all deposits");DeskSurface.button(filter,false);filter.setSelected(historyOnlyPending==pendingOnly);
                filter.setOnClickListener(view->{if(!busy&&historyOnlyPending!=pendingOnly){historyOnlyPending=pendingOnly;desk();}});
                LinearLayout.LayoutParams bounds=new LinearLayout.LayoutParams(0,-2,largeFilters?(pendingOnly?1.4f:.6f):1);bounds.rightMargin=dp(8);filters.addView(filter,bounds);
            }
            Button refresh=new Button(this);refresh.setText("↻");refresh.setContentDescription("Refresh history");DeskSurface.roundButton(refresh);
            refresh.setOnClickListener(view->{if(!busy){historySnapshot=null;desk();}});filters.addView(refresh,new LinearLayout.LayoutParams(dp(48),dp(48)));content.addView(filters);
            historyRows = new LinearLayout(this);
            historyRows.setOrientation(LinearLayout.VERTICAL);
            content.addView(historyRows);
            historySeenIds.clear();
            loadHistory("");
        } else showDepositPanel();
        showStaffMessage(false);
    }
    private GridLayout.LayoutParams tabBounds(int index,int columns){
        int span=index==2?columns-index%columns:1;
        GridLayout.LayoutParams bounds=new GridLayout.LayoutParams();bounds.rowSpec=GridLayout.spec(index/columns);
        bounds.columnSpec=GridLayout.spec(index%columns,span,1f);bounds.width=0;bounds.height=-2;
        if(index%columns+span<columns)bounds.rightMargin=dp(8);if(index/columns<2/columns)bounds.bottomMargin=dp(8);return bounds;
    }
    private void switchDeskPane(int pane) {
        if (busy || deskPane == pane || pane < 0 || pane > 2) return;
        if (deskInput != null) deskCode = deskInput.getText().toString();
        deskPane = pane;
        desk();
    }
    private String cachedBoothUrl() {
        if (context == null) return "";
        String supplied = context.optString("booth_url");
        if (!supplied.isEmpty()) return supplied;
        return getSharedPreferences("sharepass-booth-qr", MODE_PRIVATE)
            .getString(context.optString("session_key"), "");
    }
    private void showDepositPanel() {
        beginCard();
        line("Deposit passes", 20, true);
        line("Let the depositor scan and enter their details.",16,false);
        LinearLayout depositView = content;
        int qrPosition = depositView.getChildCount();
        String cached = cachedBoothUrl();
        if (!cached.isEmpty()) {
            try { showQr(boothPosterUrl(new JSONObject().put("url", cached)), "Customer deposit form QR"); }
            catch (Exception invalid) { /* Fetch the authorized link again below. */ }
        }
        if (qr == null) line("Preparing this booth’s QR…", 15, false);
        LinearLayout share = new LinearLayout(this);
        Button copy = new Button(this), whatsapp = new Button(this);
        copy.setText("Copy link"); whatsapp.setText("WhatsApp");
        DeskSurface.button(copy, false); DeskSurface.button(whatsapp, false);
        LinearLayout.LayoutParams copyBounds=new LinearLayout.LayoutParams(0,-2,1);copyBounds.rightMargin=dp(8);share.addView(copy,copyBounds);
        share.addView(whatsapp, new LinearLayout.LayoutParams(0, -2, 1));
        content.addView(share);
        copy.setOnClickListener(view -> {
            String url = cachedBoothUrl();
            if (url.isEmpty()) { note("The booth link is still loading."); return; }
            getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("SharePass deposit form", url));
            note("Deposit link copied.");
        });
        whatsapp.setOnClickListener(view -> shareBoothLink());
        line("Waiting deposits", 21, true);
        queueRows = new LinearLayout(this);
        queueRows.setOrientation(LinearLayout.VERTICAL);
        content.addView(queueRows);
        queueSnapshot = "";
        renderQueueRows();
        if(!cached.isEmpty()){scheduleQueue(0);return;}
        String session = client.token();
        polling.execute(() -> {
            try {
                String url = boothPosterUrl(client.request("/api/booth", null));
                runOnUiThread(() -> {
                    if (isDestroyed() || context == null || !session.equals(client.token())) return;
                    getSharedPreferences("sharepass-booth-qr", MODE_PRIVATE).edit()
                        .putString(context.optString("session_key"), url).apply();
                    try { context.put("booth_url", url); } catch (Exception ignored) { }
                    if (content != depositView || deskPane != 0 || !"desk".equals(screen) || qr != null && url.equals(cached)) return;
                    try {
                        releaseQr();
                        View placeholder = depositView.getChildAt(qrPosition);
                        if (placeholder instanceof TextView && !(placeholder instanceof Button)) depositView.removeView(placeholder);
                        showQr(url, "Customer deposit form QR");
                        depositView.removeView(qr);
                        depositView.addView(qr, qrPosition, qrBounds());
                    } catch (Exception invalid) { note("The deposit QR could not display. Use Copy link."); }
                });
            } catch (Exception unavailable) {
                runOnUiThread(() -> {
                    if (content == depositView && cached.isEmpty()) note("Connect to load this booth’s QR once. It is then available immediately.");
                });
            }
        });
        scheduleQueue(0);
    }
    private void shareBoothLink() {
        String url = cachedBoothUrl();
        if (url.isEmpty()) { note("The booth link is still loading."); return; }
        Intent draft = new Intent(Intent.ACTION_SEND).setType("text/plain").setPackage("com.whatsapp")
            .putExtra(Intent.EXTRA_TEXT, "Leave your passes with SharePass · " + boothLabel() + "\n" + url);
        try { startActivity(draft); }
        catch (android.content.ActivityNotFoundException unavailable) {
            draft.setPackage(null);
            startActivity(Intent.createChooser(draft, "Share deposit form"));
        }
    }
    private void loadHistory(String cursor) {
        LinearLayout rows = historyRows;
        if (rows == null) return;
        String session = client.token();
        TextView loading = new TextView(this);
        loading.setText("Loading history…"); loading.setTextColor(DeskSurface.MUTED);
        rows.addView(loading);
        polling.execute(() -> {
            try {
                JSONObject result = cursor.isEmpty()&&historySnapshot!=null&&session.equals(historySession)?historySnapshot:
                    client.request("/api/history?limit=20" + (cursor.isEmpty() ? "" : "&cursor=" + Uri.encode(cursor)), null);
                runOnUiThread(() -> {
                    if (isDestroyed() || rows != historyRows || !session.equals(client.token())) return;
                    if(cursor.isEmpty()){historySnapshot=result;historySession=session;}
                    rows.removeView(loading);
                    JSONArray deposits = result.optJSONArray("deposits");
                    if ((deposits == null || deposits.length() == 0) && cursor.isEmpty()) {
                        loading.setText("No deposits yet for this booth."); rows.addView(loading);
                    }
                    JSONArray pendingHandovers = result.optJSONArray("pending_handovers");
                    if (cursor.isEmpty() && pendingHandovers != null && pendingHandovers.length() > 0) {
                        TextView heading = new TextView(this); heading.setText("Pending handovers"); heading.setTextColor(DeskSurface.BRASS); heading.setTextSize(20); rows.addView(heading);
                        for (int i = 0; i < pendingHandovers.length(); i++) {
                            JSONObject pending = pendingHandovers.optJSONObject(i);
                            if (pending == null) continue;
                            addHistoryCard(rows, pending);
                        }
                    }
                    for (int i = 0; deposits != null && i < deposits.length(); i++) {
                        JSONObject deposit = deposits.optJSONObject(i);
                        if (deposit == null) continue;
                        addHistoryCard(rows, deposit);
                    }
                    historyCursor = result.isNull("next_cursor") ? "" : result.optString("next_cursor");
                    if (!historyOnlyPending && !historyCursor.isEmpty()) {
                        String next = historyCursor;
                        Button more = new Button(this); more.setText("Load more"); DeskSurface.button(more, false); rows.addView(more);
                        more.setOnClickListener(view -> { rows.removeView(more); loadHistory(next); });
                    }
                });
            } catch (Exception failure) {
                runOnUiThread(() -> { if (rows == historyRows) loading.setText("History is unavailable. Use Refresh and try again."); });
            }
        });
    }
    private void addHistoryCard(LinearLayout rows, JSONObject deposit) {
        if(historyOnlyPending&&!deposit.optBoolean("handover_pending")&&deposit.optJSONObject("pending_collection")==null)return;
        String id = deposit.optString("id");
        if (id.isEmpty() || !historySeenIds.add(id)) return;
        LinearLayout card = new LinearLayout(this); card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(DeskSurface.panel(this)); card.setPadding(dp(16), dp(12), dp(16), dp(16));
        LinearLayout.LayoutParams bounds = new LinearLayout.LayoutParams(-1, -2); bounds.topMargin = dp(10);
        rows.addView(card, bounds);
        TextView person=new TextView(this);String personName=deposit.optString("depositor_label").trim();person.setText(personName.isEmpty()?"Deposit":personName);
        person.setTextColor(DeskSurface.INK);person.setTextSize(20);person.setTypeface(Typeface.DEFAULT,Typeface.BOLD);card.addView(person);
        TextView detail = new TextView(this); detail.setTextColor(DeskSurface.MUTED); detail.setTextSize(16);detail.setPadding(0,dp(8),0,dp(8));
        detail.setText("Remaining · " + balance(deposit.optJSONObject("remaining")));
        card.addView(detail);
        JSONObject pending = deposit.optJSONObject("pending_collection");
        if (pending == null && deposit.optBoolean("handover_pending")) {
            TextView state = new TextView(this);
            state.setText("Handover awaiting confirmation by another staff member");
            state.setTextColor(DeskSurface.MUTED);
            card.addView(state);
        }
        if (pending != null) {
            Button resume = new Button(this); resume.setText("Resume handover"); DeskSurface.button(resume, true); card.addView(resume);
            resume.setOnClickListener(view -> run(() -> { client.resumeHandover(deposit, pending); return client.handover(); }, this::handover));
        }
        LinearLayout actions=new LinearLayout(this);LinearLayout.LayoutParams actionRow=new LinearLayout.LayoutParams(-1,-2);actionRow.topMargin=dp(8);card.addView(actions,actionRow);
        Button open=new Button(this);open.setText("Open receipt");DeskSurface.button(open,false);actions.addView(open,new LinearLayout.LayoutParams(0,-2,1));
        open.setOnClickListener(view->run(()->client.openReceipt(deposit.optString("id")),result->{
            JSONObject current=result.getJSONObject("deposit"),unfinished=current.optJSONObject("pending_collection");
            if(current.optBoolean("handover_pending")){
                if(unfinished!=null){client.resumeHandover(current,unfinished);handover(client.handover());}
                else note("This handover is awaiting confirmation by its operator.");
            }else if(hasAvailable(current.optJSONObject("remaining")))receipt(result);
            else stockResult(result.put("action_path","/api/collections/history/handover"));
        }));
        if(pending==null&&!deposit.optBoolean("handover_pending")&&hasAvailable(deposit.optJSONObject("remaining"))){
            Button collect=new Button(this);collect.setText("Collect passes");DeskSurface.button(collect,true);LinearLayout.LayoutParams collectBounds=new LinearLayout.LayoutParams(0,-2,1);collectBounds.leftMargin=dp(8);actions.addView(collect,collectBounds);
            collect.setOnClickListener(view->run(()->client.openReceipt(deposit.optString("id")),result->verifyPickup(result.getString("collection_code"),result.getJSONObject("deposit").getString("packet_id"))));
        }
    }
    private static boolean hasAvailable(JSONObject quantities){
        for(String key:KEYS)if(quantities!=null&&quantities.optInt(key)>0)return true;
        return false;
    }
    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        if (updates != null && event.getActionMasked() == MotionEvent.ACTION_DOWN) updates.cancelDownload();
        if ("desk".equals(screen) && !busy && client!=null && !client.hasPending() && client.handover()==null) {
            if (event.getActionMasked()==MotionEvent.ACTION_DOWN) {
                deskTouchX=event.getX();deskTouchY=event.getY();
                deskSwipeStarted=viewport.contains(deskTouchX,deskTouchY);
            } else if (event.getActionMasked()==MotionEvent.ACTION_CANCEL) {
                deskSwipeStarted=false;
            } else if (event.getActionMasked()==MotionEvent.ACTION_UP && deskSwipeStarted) {
                deskSwipeStarted=false;
                float dx=event.getX()-deskTouchX,dy=event.getY()-deskTouchY;
                if (Math.abs(dx)>dp(64) && Math.abs(dx)>1.6f*Math.abs(dy) && (deskPane + (dx < 0 ? 1 : -1)) >= 0 && (deskPane + (dx < 0 ? 1 : -1)) <= 2) {
                    MotionEvent cancel=MotionEvent.obtain(event);
                    cancel.setAction(MotionEvent.ACTION_CANCEL);
                    super.dispatchTouchEvent(cancel);
                    cancel.recycle();
                    switchDeskPane(deskPane + (dx < 0 ? 1 : -1));
                    return true;
                }
            }
        }
        return super.dispatchTouchEvent(event);
    }

    private boolean updateIdle() {
        if (!foreground || busy || context == null || client == null || client.hasPending() || client.handover() != null
                || !("desk".equals(screen) || "desk-options".equals(screen))) return false;
        JSONObject intake = client.intake();
        if (intake != null && intake.optLong("expires_at") > System.currentTimeMillis()) return false;
        return deskPane != 1 || (deskInput != null ? deskInput.length() == 0 : deskCode.isEmpty());
    }
    private void openAdminAccount() {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(HostedRegisterClient.ORIGIN + "/owner-signin")));
        } catch (android.content.ActivityNotFoundException error) { note("Open SharePass Account in your browser."); }
    }
    private String queueLabel() {
        int count = queueDrafts.length();
        return count == 0 ? "Booth queue" : "Booth queue · " + count + " waiting";
    }
    private void clearQueue() {
        context = null;
        deskPane = 0;
        manualQueueRefresh = false;
        deskCode = "";
        requestedQueue = false;
        queueBaseline = false;
        seenQueue.clear();
        seenStaffMessages.clear();
        staffMessages = new JSONArray();
        queueDrafts = new JSONArray();
        handler.removeCallbacks(queuePoll);
        QueueNotifications.cancel(this);
    }
    private void refreshQueueNow() {
        historySnapshot=null;
        run(client::context,this::signedIn);
    }
    private void scheduleQueue(long delay) {
        if (delay >= 2000 && context != null && context.optBoolean("push_first")) delay = Math.max(delay, 15_000);
        handler.removeCallbacks(queuePoll);
        if (foreground && context != null && !context.optString("staff_label").isEmpty()) {
            handler.postDelayed(queuePoll, delay);
        }
    }
    private void checkQueue() {
        if (!foreground || context == null) return;
        if (busy || checkingQueue || checkingIntake) { scheduleQueue(1000); return; }
        if (requestedQueue && ("desk".equals(screen) || "queue".equals(screen))
                && !client.hasPending() && client.handover() == null) {
            requestedQueue = false;
            if (!"desk".equals(screen) || deskPane != 0) { deskPane = 0; desk(); }
        }
        checkingQueue = true;
        String session = client.token();
        polling.execute(() -> {
            try {
                JSONObject queue = client.request("/api/queue", null);
                JSONArray drafts = queue.getJSONArray("drafts");
                JSONArray messages = queue.optJSONArray("messages");
                runOnUiThread(() -> {
                    checkingQueue = false;
                    if (isDestroyed() || !foreground || context == null || !session.equals(client.token())) return;
                    HashSet<String> waiting = new HashSet<>();
                    JSONArray arrivals=new JSONArray();
                    for (int i = 0; i < drafts.length(); i++) {
                        JSONObject draft = drafts.optJSONObject(i);
                        String token = draft == null ? "" : draft.optString("token");
                        if (validQueueToken(token)) {waiting.add(token);if(!seenQueue.contains(token))arrivals.put(draft);}
                    }
                    int newCount = 0;
                    for (String token : waiting) if (!seenQueue.contains(token)) newCount++;
                    seenQueue.clear();
                    seenQueue.addAll(waiting);
                    if (queueBaseline && newCount > 0) {
                        String summary=QueueSummary.body(arrivals,null);
                        QueueNotifications.show(this,newCount,summary);
                        note(summary+" · Waiting for booth review.");
                    }
                    if (waiting.isEmpty()) QueueNotifications.cancel(this);
                    queueBaseline = true;
                    queueDrafts = drafts;
                    staffMessages = messages == null ? new JSONArray() : messages;
                    updateStaffMessageButton();
                    showStaffMessage(false);
                    if (queueButton != null) queueButton.setText(queueLabel());
                    if (queueRows != null && !busy) renderQueueRows();
                    if (manualQueueRefresh) {
                        manualQueueRefresh=false;
                        if ("desk".equals(screen) || "queue".equals(screen) || "desk-options".equals(screen)) note("Connected. " + waiting.size() + " waiting.");
                    } else if (queueRows != null && !busy && newCount==0) note("");
                    scheduleQueue(60000);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    checkingQueue = false;
                    if (isDestroyed() || !foreground || context == null || !session.equals(client.token())) return;
                    if (error instanceof HostedRegisterClient.Rejected && ((HostedRegisterClient.Rejected) error).status == 401) {
                        if (!busy) failed(error);
                    } else if (queueRows != null || manualQueueRefresh) note("Connection lost. Reconnecting automatically…");
                    manualQueueRefresh=false;
                    scheduleQueue(60000);
                });
            }
        });
    }
    private void addStaffMessageButton() {
        updateStaffMessageButton();
    }

    private void updateStaffMessageButton() {
        if (staffMessageButton == null) return;
        staffMessageButton.setVisibility(staffMessages.length() == 0 ? View.GONE : View.VISIBLE);
        staffMessageButton.setText("✉ "+staffMessages.length());
        staffMessageButton.setTextSize(16);staffMessageButton.setContentDescription("Staff messages ("+staffMessages.length()+")");
    }

    private boolean staffMessagesAllowed() {
        return foreground && !busy && ("desk".equals(screen) || "queue".equals(screen))
            && !client.hasPending() && client.handover() == null;
    }

    private JSONObject pendingStaffMessage(String id) {
        for (int i = 0; i < staffMessages.length(); i++) {
            JSONObject message = staffMessages.optJSONObject(i);
            if (message != null && validQueueToken(id) && id.equals(message.optString("id"))
                    && message.optLong("expires_at") > System.currentTimeMillis()) return message;
        }
        return null;
    }

    private void presentStaffDialog(AlertDialog next) {
        staffMessageDialog = next;
        next.setOnDismissListener(dialog -> {
            if (staffMessageDialog == next) staffMessageDialog = null;
        });
        next.show();
    }

    private void showStaffMessage(boolean manual) {
        if (!staffMessagesAllowed() || !hasWindowFocus() || staffMessageDialog != null
                || !manual && deskInput != null && deskInput.length() > 0) return;
        String session = client.token();
        ArrayList<String> ids = new ArrayList<>();
        ArrayList<String> labels = new ArrayList<>();
        for (int i = 0; i < staffMessages.length(); i++) {
            JSONObject message = staffMessages.optJSONObject(i);
            if (message == null) continue;
            String id = message.optString("id");
            if (pendingStaffMessage(id) == null) continue;
            if (!manual) {
                if (seenStaffMessages.contains(id)) continue;
                openStaffMessage(id, session);
                return;
            }
            ids.add(id);
            labels.add(message.optString("message"));
        }
        if (!manual) return;
        if (ids.isEmpty()) { note("No pending staff messages."); return; }
        presentStaffDialog(new AlertDialog.Builder(this).setTitle("Pending staff messages")
            .setItems(labels.toArray(new String[0]), (dialog, choice) -> {
                if (dialog != staffMessageDialog) return;
                // Dismiss the picker before opening the chosen message. Its delayed
                // dismiss callback must not clear the new dialog's ownership.
                dialog.dismiss();
                openStaffMessage(ids.get(choice), session);
            }).setNegativeButton("Close", null).create());
    }

    private void openStaffMessage(String id, String session) {
        if (!staffMessagesAllowed() || !session.equals(client.token())) return;
        JSONObject message = pendingStaffMessage(id);
        if (message == null) { note("This staff message is no longer pending."); return; }
        seenStaffMessages.add(id);
        String[] replies = {"done", "working", "help"};
        presentStaffDialog(new AlertDialog.Builder(this).setCustomTitle(staffMessageTitle(message.optString("message")))
            .setItems(new String[]{"Done", "Working on it", "Need help"}, (dialog, choice) -> {
                if (dialog != staffMessageDialog || !staffMessagesAllowed() || !session.equals(client.token())) return;
                if (pendingStaffMessage(id) == null) {
                    note("This staff message is no longer pending.");
                    return;
                }
                run(() -> client.request("/api/staff-messages/reply",
                    new JSONObject().put("id", id).put("reply", replies[choice])), result -> {
                        if (!staffMessagesAllowed() || !session.equals(client.token())) return;
                        note("Reply sent.");
                        scheduleQueue(0);
                    });
            }).setNegativeButton("Later", null).create());
    }
    private View staffMessageTitle(String message){
        LinearLayout title=new LinearLayout(this);title.setOrientation(LinearLayout.VERTICAL);title.setPadding(dp(24),dp(20),dp(24),dp(8));
        TextView caption=new TextView(this);caption.setText("Message from admin");caption.setTextSize(20);caption.setTextColor(DeskSurface.INK);caption.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        if(Build.VERSION.SDK_INT>=28)caption.setAccessibilityHeading(true);title.addView(caption);
        TextView body=new TextView(this);body.setText(message);body.setTextSize(18);body.setTextColor(DeskSurface.INK);body.setPadding(0,dp(12),0,dp(8));
        body.setMaxHeight(Math.max(dp(100),Math.min(dp(240),viewport.paneHeight()/3)));body.setVerticalScrollBarEnabled(true);
        body.setMovementMethod(android.text.method.ScrollingMovementMethod.getInstance());body.setFocusable(true);title.addView(body);return title;
    }
    private static boolean validQueueToken(String token) { return token.matches("[a-f0-9-]{36}"); }
    private boolean notificationsAllowed() {
        return QueueNotifications.allowed(this);
    }
    private void openAlertSettings() {
        QueueNotifications.ensureChannel(this);
        Intent settings;
        if(Build.VERSION.SDK_INT>=26&&!notificationsAllowed()){
            settings=new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName());
        } else if (Build.VERSION.SDK_INT >= 26) {
            settings = new Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName())
                .putExtra(android.provider.Settings.EXTRA_CHANNEL_ID, QueueNotifications.CHANNEL);
        } else settings = new Intent(android.provider.Settings.ACTION_SOUND_SETTINGS);
        try{startActivity(settings);}
        catch(android.content.ActivityNotFoundException unavailable){note("Open SharePass notifications in Android settings.");}
    }
    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, QueueNotifications.NOTICE_ID);
        } else openAlertSettings();
    }
    private void requestSetupPermissions() {
        android.content.SharedPreferences preferences = getSharedPreferences("sharepass-permissions", MODE_PRIVATE);
        if (preferences.getBoolean("requested", false)) return;
        ArrayList<String> permissions = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            permissions.add(android.Manifest.permission.POST_NOTIFICATIONS);
        preferences.edit().putBoolean("requested", true).apply();
        QueueNotifications.ensureChannel(this);
        UpdateNotifications.ensureChannel(this);
        if (!permissions.isEmpty()) requestPermissions(permissions.toArray(new String[0]), SETUP_PERMISSIONS);
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == CAMERA_SCAN) {
            if (checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) scanQr(scanningSetup);
            else note(scanningSetup?"Camera access is off. Enter the setup code or paste its link.":"Camera access is off. Enter the collection code or use the current receipt link.");
        }
        if (request == QueueNotifications.NOTICE_ID || request == SETUP_PERMISSIONS) {
            if (client != null && context != null && !client.token().isEmpty()) {
                QueuePush.sync(this, client.token());
                scheduleQueue(0);
                reportDeviceStatus();
            }
            if (request == QueueNotifications.NOTICE_ID) note(notificationsAllowed() ? "Booth alerts are on." : "Booth alerts are off. The queue still updates here.");
        }
    }
    private void reportDeviceStatus() {
        if (client == null || context == null || client.token().isEmpty()) return;
        String session = client.token();
        boolean notifications = notificationsAllowed();
        polling.execute(() -> {
            try {
                if (!session.equals(client.token())) return;
                client.deviceStatus(session, notifications);
            } catch (Exception unavailable) { /* The next foreground entry retries; custody remains independent. */ }
        });
    }
    private void scanQr(boolean setup) {
        if (busy || client == null || client.hasPending() || client.handover() != null) return;
        scanningSetup = setup;
        if (checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.CAMERA}, CAMERA_SCAN);
            return;
        }
        scannerSession = client.token();
        page(setup ? "Scan setup QR" : "Scan pickup QR", "scanner", setup ? this::login : this::desk);
        line(setup ? "Point the camera at your supervisor’s setup QR." : "Scan the SharePass pickup code or its WhatsApp QR.", 16, false);
        scanner = new com.journeyapps.barcodescanner.DecoratedBarcodeView(this);
        scanner.getBarcodeView().setDecoderFactory(new com.journeyapps.barcodescanner.DefaultDecoderFactory(
            Collections.singletonList(com.google.zxing.BarcodeFormat.QR_CODE)));
        scanner.setStatusText("Keep the QR inside the frame");
        content.addView(scanner, new LinearLayout.LayoutParams(-1, dp(320)));
        scanner.decodeSingle(new com.journeyapps.barcodescanner.BarcodeCallback() {
            @Override public void possibleResultPoints(java.util.List<com.google.zxing.ResultPoint> points) { }
            @Override public void barcodeResult(com.journeyapps.barcodescanner.BarcodeResult result) {
                if (!foreground || !"scanner".equals(screen) || !scannerSession.equals(client.token()) || busy) return;
                String value = result.getText();
                if (setup) {
                    String invite = HostedRegisterClient.setupInvite(value);
                    if (invite.isEmpty()) { login(); note("This is not a valid SharePass setup QR."); return; }
                    pairingInvite(invite);
                } else {
                    try {
                        PickupScan.Details pickup = PickupScan.parse(value,HostedRegisterClient.ORIGIN);
                        desk(pickup.code());
                        verifyPickup(pickup.code(), pickup.reference());
                    } catch (IllegalArgumentException invalid) { desk(); note("Scan a SharePass pickup QR or enter its four-digit code."); }
                }
            }
        });
        scanner.resume();
    }
    private String boothPosterUrl(JSONObject result) throws Exception {
        String url = result.getString("url");
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme()) || !Uri.parse(HostedRegisterClient.ORIGIN).getEncodedAuthority().equals(uri.getEncodedAuthority())) {
            throw new IOException("The booth link was invalid.");
        }
        return url;
    }
    private void boothPoster(JSONObject result) throws Exception {
        String url = boothPosterUrl(result);
        page("Booth poster QR", "booth-poster", this::desk);
        line("Print this once and place it where people can scan it before they reach the counter.", 17, false);
        showQr(url, "Reusable booth registration QR");
        button("Copy booth link", () -> {
            getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("SharePass booth", url));
            note("Booth link copied.");
        }, false);
    }
    private void queue() {
        QueueNotifications.cancel(this);
        deskPane = 0;
        desk();
    }
    private void renderQueueRows() {
        String snapshot = queueDrafts.toString();
        if (snapshot.equals(queueSnapshot)) return;
        queueSnapshot = snapshot;
        queueRows.removeAllViews();
        if (queueDrafts.length() == 0) {
            TextView empty = new TextView(this);
            empty.setText("No deposits waiting. Leave SharePass open for updates.");
            empty.setTextSize(16);
            empty.setTextColor(DeskSurface.MUTED);
            empty.setPadding(0, dp(12), 0, dp(12));
            queueRows.addView(empty);
        }
        for (int i = 0; i < queueDrafts.length(); i++) {
            JSONObject draft = queueDrafts.optJSONObject(i);
            if (draft == null || !validQueueToken(draft.optString("token"))) continue;
            String token = draft.optString("token");
            LinearLayout item=new LinearLayout(this);item.setOrientation(LinearLayout.VERTICAL);item.setBackground(DeskSurface.panel(this));item.setPadding(dp(12),dp(12),dp(12),dp(12));
            LinearLayout title=new LinearLayout(this);title.setGravity(android.view.Gravity.CENTER_VERTICAL);
            TextView name=new TextView(this);name.setText(draft.optString("name","Customer"));name.setTextSize(18);name.setTextColor(DeskSurface.INK);name.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
            title.addView(name,new LinearLayout.LayoutParams(0,-2,1));
            Button review=new Button(this);review.setText("Review");review.setContentDescription("Review deposit for "+draft.optString("name","Customer"));DeskSurface.button(review,true);
            LinearLayout.LayoutParams reviewBounds=new LinearLayout.LayoutParams(-2,-2);reviewBounds.leftMargin=dp(8);title.addView(review,reviewBounds);item.addView(title);
            TextView counts=new TextView(this);counts.setText(balance(draft.optJSONObject("quantities")));counts.setTextSize(16);counts.setTextColor(DeskSurface.MUTED);counts.setPadding(0,dp(8),0,0);item.addView(counts);
            LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(-1, -2);
            size.topMargin = dp(10);
            queueRows.addView(item, size);
            review.setOnClickListener(view -> run(() -> client.request("/api/queue/" + token, null), value -> queueReview(token, value)));
        }
    }
    private void queueReview(String token, JSONObject draft) throws Exception {
        if (context.optBoolean("ticket_receipts")) {
            queueReview(token, draft, "");
            return;
        }
        // Older registers still require the shelf field when confirming the queue.
        JSONObject counts = draft.getJSONObject("quantities");
        Wizard wizard = new Wizard(this::queue, () -> {});
        wizard.review("Match the customer and passes", draft.optString("name") + "\n" + balance(counts), "Next");
        depositConfirmation(wizard, "/api/queue/" + token + "/confirm", new DepositDraft(), counts);
        wizard.start();
    }
    private void queueReview(String token, JSONObject draft, String suggested) throws Exception {
        JSONObject quantities = draft.getJSONObject("quantities");
        page("Match the customer and passes", "queue-review", this::desk);
        line(draft.optString("name") + (draft.optString("collection_code").isEmpty()?"":" · "+draft.optString("collection_code")), 22, true);
        line(balance(quantities), 24, true);
        String phone = draft.optString("phone");
        if (!phone.isEmpty()) line("Depositor WhatsApp · " + phone, 16, false);
        JSONArray people = draft.optJSONArray("recipients");
        for (int i=0; people!=null && i<people.length(); i++) {
            JSONObject person = people.optJSONObject(i);
            if (person==null || person.optString("phone").isEmpty()) continue;
            String summary = person.optString("name") + " · " + person.optString("phone");
            if (person.has("quantities")) summary += " · " + balance(person.optJSONObject("quantities"));
            line(summary, 16, false);
        }
        if (!suggested.isEmpty()) line("Suggested code · " + suggested, 17, false);
        line("Confirm once you have counted and received these passes.", 16, false);
        button("Confirm received · " + balance(quantities), () -> run(() -> {
            JSONObject body = new JSONObject().put("custody_confirmed", true).put("valid_minutes", 1440);
            if (!suggested.isEmpty()) body.put("suggested_code", suggested);
            return client.stockChange("/api/queue/" + token + "/confirm", body);
        }, this::stockResult), true);
        if(draft.optInt("intake_version")!=2)button("Refresh code suggestion", () -> run(() -> client.request("/api/codes/suggest?exclude=" + suggested, null),
            result -> queueReview(token, draft, result.getString("code"))), false);
    }
    private void depositConfirmation(Wizard wizard, String path, DepositDraft draft, JSONObject reviewed) {
        wizard.text("Shelf or slot", draft.shelf, InputType.TYPE_CLASS_TEXT, 30, "", (value, validate) -> {
            draft.shelf = value;
            return validate && value.isEmpty() ? "Enter a shelf or slot" : null;
        });
        int confirmStep = wizard.steps.size();
        wizard.steps.add((previous, next) -> {
            page("Confirm receipt", "deposit-confirm", previous);
            JSONObject quantities;
            try { quantities = draft.quantities == null ? reviewed : readQuantities(draft.quantities); }
            catch (Exception error) { note(error.getMessage()); return; }
            line(balance(quantities), 21, true);
            line("Shelf or slot · " + draft.shelf, 17, false);
            String codeChoice = draft.code.isEmpty() ? "Automatic code" : "Custom code " + draft.code;
            line(codeChoice + (draft.minutes > 0 ? " · Expires in " + draft.minutes + " minutes" : " · Default expiry"), 17, false);
            line("Confirm once the passes are in your hands.", 17, false);
            button("Code and expiry options", () -> wizard.show(confirmStep + 1), false);
            button("I received the passes", () -> run(() -> {
                JSONObject body = new JSONObject().put("location", draft.shelf).put("custody_confirmed", true);
                if (draft.quantities != null) body.put("quantities", quantities).put("manual", true);
                if (!draft.code.isEmpty()) body.put("custom_code", draft.code);
                if (draft.minutes > 0) body.put("valid_minutes", draft.minutes);
                return client.stockChange(path, body);
            }, this::stockResult), true);
        });
        wizard.text("Custom code (optional)", draft.code, InputType.TYPE_CLASS_NUMBER,
            4, "Four digits", (value, validate) -> {
                draft.code = value;
                return validate && !draft.code.isEmpty() && !draft.code.matches("[0-9]{4}")
                    ? "Enter four digits" : null;
            }, Collections.singletonMap("Use automatic code", ""));
        Map<String, String> expiryChoices = new LinkedHashMap<>();
        expiryChoices.put("1 hour", "60");
        expiryChoices.put("1 day", "1440");
        expiryChoices.put("2 days", "2880");
        wizard.text("Code lifetime (optional)", "", InputType.TYPE_CLASS_NUMBER, 4, "5–2880 minutes", (value, validate) -> {
            try { draft.minutes = value.isEmpty() ? 0 : Integer.parseInt(value); }
            catch (NumberFormatException error) { return validate ? "Enter whole minutes" : null; }
            return validate && !value.isEmpty() && (draft.minutes < 5 || draft.minutes > 2880) ? "Use 5–2880 minutes" : null;
        }, expiryChoices);
        wizard.steps.add((previous, next) -> wizard.show(confirmStep));
    }
    private void intake(JSONObject result) throws Exception {
        intakeToken = result.getString("token");
        String url = result.getString("url");
        if (!url.equals(HostedRegisterClient.ORIGIN + "/intake/" + intakeToken)
                && !url.equals(HostedRegisterClient.ORIGIN + "/intake?token=" + intakeToken)) {
            throw new IOException("The registration link was invalid.");
        }
        page("Scan to register", "intake", this::desk);
        line("The depositor scans this code and fills in their details.", 17, false);
        showQr(url, "Deposit registration QR");
        if (context.optBoolean("push_first")) button("Check one-time form", () -> scheduleIntake(0), false);
        button("Enter details manually", () -> manualDeposit(intakeToken), false);
        scheduleIntake(1000);
    }
    private void showQr(String value, String label) throws Exception {
        qr = QrPreview.create(this, value, label, () -> "desk".equals(screen) ? Math.max(dp(160),Math.min(viewport.paneHeight()-dp(440),dp(420))) : viewport.paneHeight());
        content.addView(qr, qrBounds());
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    private LinearLayout.LayoutParams qrBounds() {
        LinearLayout.LayoutParams bounds = new LinearLayout.LayoutParams(-2, -2);
        bounds.gravity = android.view.Gravity.CENTER_HORIZONTAL;
        bounds.topMargin=dp(12);bounds.bottomMargin=dp(12);
        return bounds;
    }
    private void scheduleIntake(long delay) {
        if (delay>=2000 && context!=null && context.optBoolean("push_first")) return;
        if (foreground && "intake".equals(screen)) {
            handler.removeCallbacks(intakePoll);
            handler.postDelayed(intakePoll, delay);
        }
    }
    private void checkIntake() {
        if (!foreground || !"intake".equals(screen)) return;
        if (busy || checkingIntake) { scheduleIntake(500); return; }
        checkingIntake = true;
        String token = intakeToken;
        polling.execute(() -> {
            try {
                JSONObject state = client.request("/api/intakes/" + token, null);
                runOnUiThread(() -> {
                    checkingIntake = false;
                    if (isDestroyed() || !foreground || !"intake".equals(screen) || !token.equals(intakeToken)) return;
                    if (busy) { scheduleIntake(500); return; }
                    try {
                        String stateName = state.optString("status");
                        if ("submitted".equals(stateName)) review(token, state);
                        else if ("confirmed".equals(stateName)) {
                            page("Deposit already confirmed", "confirmed", this::desk);
                            button("Start another deposit", () -> run(client::startIntake, this::intake), true);
                        } else scheduleIntake(15000);
                    } catch (Exception error) { failed(error); }
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    checkingIntake = false;
                    if (isDestroyed() || !foreground || !"intake".equals(screen) || !token.equals(intakeToken)) return;
                    if (busy) { scheduleIntake(500); return; }
                    failed(error);
                    if (!"intake".equals(screen)) return;
                    if (error instanceof HostedRegisterClient.Rejected && ((HostedRegisterClient.Rejected) error).status < 500) {
                        button("Generate another QR", () -> run(client::startIntake, this::intake), true);
                    } else scheduleIntake(15000);
                });
            }
        });
    }
    private void review(String token, JSONObject intake) throws Exception {
        Wizard wizard = new Wizard(this::desk, () -> {});
        String name = intake.optString("name");
        JSONObject quantities = intake.getJSONObject("quantities");
        wizard.review("Check customer name", name.isEmpty() ? "Name not provided" : name, "Next");
        wizard.review("Check pass counts", balance(quantities), "Next");
        depositConfirmation(wizard, "/api/intakes/" + token + "/confirm", new DepositDraft(), quantities);
        wizard.start();
    }
    private void manualDeposit(String token) {
        Wizard wizard = new Wizard(this::desk, () -> {});
        DepositDraft draft = new DepositDraft();
        draft.quantities = new int[KEYS.length];
        quantitySteps(wizard, draft.quantities, null);
        depositConfirmation(wizard, "/api/intakes/" + token + "/confirm", draft, null);
        wizard.start();
    }
    private void stockResult(JSONObject result) throws Exception {
        historySnapshot=null;
        String path = result.getString("action_path");
        if (path.startsWith("/api/queue/") && context.optBoolean("push_first")) scheduleQueue(0);
        if (path.endsWith("/release")) handover(result);
        else if (path.endsWith("/handover")) {
            page("Passes handed over", "done", this::desk);
            JSONObject completed=result.optJSONObject("collection");if(completed==null)completed=result.optJSONObject("last_collection");
            line("Depositor · "+firstNonEmpty(result.getJSONObject("deposit").optString("depositor_label"),"Name not recorded"),17,true);
            line((path.equals("/api/collections/history/handover")?"Last collector · ":"Collector · ")+firstNonEmpty(completed==null?"":completed.optString("collector_label"),"Name not recorded"),17,true);
            line("Remaining · " + balance(result.getJSONObject("deposit").getJSONObject("remaining")), 19, true);
            JSONObject update=result.optJSONObject("depositor_update");
            if (update != null && "whatsapp".equals(update.optString("channel"))) {
                line(hasAvailable(result.getJSONObject("deposit").getJSONObject("remaining"))?"Depositor update":"Final depositor update",16,true);
                messageButton(update.optString("name"), () -> compose(
                    update.optString("address"), update.optString("message")));
            }
            button("Done", this::desk, true);
            if(!path.equals("/api/collections/history/handover"))note("Handover confirmed.");
        } else {
            receipt(result);
            if(path.equals("/api/codes/refresh")||path.equals("/api/admin/reissue"))note("Collection code updated.");
            else if(path.equals("/api/deposits")||path.endsWith("/confirm"))note("Passes received. Collection code ready.");
        }
    }
    private void receipt(JSONObject result) {
        page("Passes deposited", "receipt", this::desk);
        line("Collection code", 15, true);
        TextView code = line(result.optString("collection_code"), 44, true);
        code.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        code.setFocusable(true);
        code.setOnClickListener(view->speakDigits(code.getText().toString()));
        code.setTextColor(DeskSurface.BRASS);
        code.setBackground(DeskSurface.panel(this));
        code.setPadding(dp(14), dp(9), dp(14), dp(9));
        if (context.optBoolean("ticket_receipts")) {
            content.removeView(code);
            LinearLayout row = new LinearLayout(this);
            row.setGravity(android.view.Gravity.CENTER_VERTICAL);
            row.addView(code, new LinearLayout.LayoutParams(0, -2, 1));
            Button rotate = new Button(this); rotate.setText("↻"); rotate.setContentDescription("Replace this collection code");
            DeskSurface.roundButton(rotate);
            row.addView(rotate, new LinearLayout.LayoutParams(dp(52), dp(52)));
            rotate.setOnClickListener(view -> { if (!busy) refreshCode(result); });
            content.addView(row);
        }
        JSONObject deposit = result.optJSONObject("deposit");
        line(result.optString("depositor_name",deposit.optString("depositor_label")),17,false);
        if (deposit.optLong("code_expires_at") > 0) {
            String time = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT)
                .format(new java.util.Date(deposit.optLong("code_expires_at")));
            line("Code expires " + time, 15, false);
        }
        JSONObject proof = result.optJSONObject("depositor_receipt");
        button("Share code", () -> sharing(result), true);
        if (proof != null) {
            line(result.optString("action_path").equals("/api/codes/refresh")||result.optString("action_path").equals("/api/admin/reissue")?"New collection code":"Deposit confirmation",16,true);
            messageButton(result.optString("depositor_name",deposit.optString("depositor_label")), () -> compose(proof.optString("address"), proof.optString("message")));
        } else if(!result.optString("depositor_phone").isEmpty()||result.optJSONObject("depositor_update")!=null||deposit.optJSONObject("update_contact")!=null){
            line("Depositor update",16,true);
            messageButton(result.optJSONObject("depositor_update")==null?"":result.optJSONObject("depositor_update").optString("name"),()->run(()->client.openReceipt(deposit.getString("id")),current->{JSONObject update=current.optJSONObject("depositor_update");if(update!=null)compose(update.optString("address"),update.optString("message"));else note("No depositor WhatsApp contact was provided.");}));
        }

        button("Done", this::desk, false);
    }
    private void refreshCode(JSONObject result) {
        new AlertDialog.Builder(this).setTitle("Replace collection code?")
            .setMessage("The old code will stop working. Share the replacement with the depositor and recipients.")
            .setNegativeButton("Keep code", null)
            .setPositiveButton("Replace code", (dialog, which) -> run(() -> client.stockChange("/api/codes/refresh",
                new JSONObject().put("packet_id", result.getJSONObject("deposit").getString("packet_id"))
                    .put("collection_code", result.getString("collection_code"))), this::stockResult)).show();
    }
    private static String firstNonEmpty(String... values) {
        for (String value : values) if (value != null && !value.trim().isEmpty()) return value.trim();
        return "";
    }
    private void pickupPreferences(JSONObject receipt) {
        page("WhatsApp pickup updates", "pickup-updates", () -> receipt(receipt));
        if ("whatsapp".equals(receipt.optString("update_channel"))) line("WhatsApp updates are on.", 16, false);
        EditText input = field("Depositor WhatsApp number", InputType.TYPE_CLASS_PHONE, 40);
        input.setHint("10-digit mobile or international + code");
        JSONObject depositorProof = receipt.optJSONObject("depositor_receipt");
        input.setText(firstNonEmpty(receipt.optString("update_address"), receipt.optString("depositor_phone"), depositorProof == null ? "" : depositorProof.optString("address")));
        button("Save WhatsApp updates", () -> {
            try { savePickupPreference(receipt, "whatsapp", "+" + WhatsAppDraft.phone(input.getText().toString())); }
            catch (IllegalArgumentException error) { input.setError(error.getMessage()); }
        }, true);
        if (!receipt.optString("update_channel").isEmpty()) {
            button("Turn off updates", () -> savePickupPreference(receipt, "none", ""), false);
        }
    }
    private void savePickupPreference(JSONObject receipt,String channel,String address) {
        run(() -> {
            JSONObject deposit=receipt.getJSONObject("deposit");
            JSONObject body=new JSONObject().put("request_id",java.util.UUID.randomUUID().toString())
                .put("packet_id",deposit.getString("packet_id")).put("channel",channel)
                .put("name",deposit.optString("depositor_label"));
            if(!channel.equals("none"))body.put("phone",address);
            JSONObject result=client.request("/api/deposits/"+deposit.getString("id")+"/updates",body);
            client.rememberUpdateChannel(result.optString("update_channel"), address);
            return result;
        }, result -> receipt(client.receipt()));
    }
    private void collectionEntry(String initial) {
        line("Enter the 4 digits on the pickup receipt.", 16, false);
        LinearLayout entry=new LinearLayout(this);entry.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView caption=new TextView(this);caption.setText("Code");caption.setTextSize(15);caption.setTextColor(DeskSurface.INK);caption.setTypeface(Typeface.DEFAULT,Typeface.BOLD);entry.addView(caption,new LinearLayout.LayoutParams(0,-2,1));
        TextView alternative=new TextView(this);alternative.setText("or");alternative.setTextSize(16);alternative.setTextColor(DeskSurface.MUTED);alternative.setPadding(dp(8),0,dp(8),0);entry.addView(alternative);
        Button scan=new Button(this);scan.setText("Scan QR");scan.setContentDescription("Scan pickup QR");DeskSurface.button(scan,false);scan.setOnClickListener(view->{if(!busy)scanQr(false);});entry.addView(scan);content.addView(entry);
        EditText input=textInput(InputType.TYPE_CLASS_NUMBER,4);input.setContentDescription("Collection code");caption.setLabelFor(input.getId());content.addView(input);
        input.setText(initial);
        input.setTextSize(26);
        input.setShowSoftInputOnFocus(false);
        deskInput = input;
        Runnable find = () -> {
            String code = input.getText().toString().trim();
            if (!code.matches("[0-9]{4}")) { input.setError("Enter four digits"); return; }
            deskCode = code;
            verifyPickup(code, "");
        };
        autoAdvance(input, value -> value.matches("[0-9]{4}"), find);
        drawKeypad(input);
        retryLookup = button("Retry lookup", find, false);
        retryLookup.setVisibility(initial.matches("[0-9]{4}") ? View.VISIBLE : View.GONE);
    }
    private void verifyPickup(String code, String reference) {
        run(() -> {
            JSONObject body = new JSONObject().put("collection_code", code);
            if (!reference.isEmpty()) body.put("collection_reference", reference);
            try {
                return client.request("/api/verify", body);
            } catch (HostedRegisterClient.Rejected error) {
                if (!error.pickupReferenceRequired || !reference.isEmpty()) throw error;
                return new JSONObject().put("pickup_reference_required", true);
            }
        }, result -> {
            if (result.optBoolean("pickup_reference_required")) pickupReference(code);
            else prepare(result, code);
        });
    }

    private void pickupReference(String code) {
        page("Check the pickup receipt", "pickup-reference", () -> desk(code));
        line("Paste the current receipt link or scan its QR. The four-digit code alone cannot identify this deposit.",17,false);
        EditText reference=field("Current receipt link",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI,1024);
        reference.setHint("Paste the link from the collector’s receipt");
        Runnable check = () -> {
            try{PickupScan.Details receipt=PickupScan.receiptForCode(reference.getText().toString(),code,HostedRegisterClient.ORIGIN);verifyPickup(code,receipt.reference());}
            catch(IllegalArgumentException invalid){reference.setError("Paste a current receipt link for code "+code+".");}
        };
        button("Find passes", check, true);
        button("Scan current receipt QR",()->scanQr(false),false);
    }
    private void drawKeypad(EditText input) {
        String keys = "1234567890";
        int preferredColumns = 3;
        GridLayout keysGrid = new GridLayout(this);
        keysGrid.setColumnCount(preferredColumns);
        content.addView(keysGrid, new LinearLayout.LayoutParams(-1, -2));
        keysGrid.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            int columns = DeskGeometry.keypadColumns(right - left, dp(48), preferredColumns);
            if (keysGrid.getColumnCount() == columns) return;
            // Clear GridLayout's resolved indices before reducing its column count.
            keysGrid.setColumnCount(GridLayout.UNDEFINED);
            for (int i=0; i<keysGrid.getChildCount(); i++) {
                keysGrid.getChildAt(i).setLayoutParams(keyBounds(i, columns));
            }
            keysGrid.setColumnCount(columns);
        });
        for (int i=0; i<keys.length(); i++) {
            String key=keys.substring(i,i+1);
            Button button = keypadButton(key,key,() -> {
                input.requestFocus();
                if (input.length()<4) { speakDigits(key);input.append(key);input.setSelection(input.length()); }
            });
            keysGrid.addView(button, keyBounds(i, preferredColumns));
        }
        Button erase = keypadButton("⌫","Delete last digit",() -> {
            input.requestFocus();
            if (input.length()>0) input.getText().delete(input.length()-1,input.length());
        });
        keysGrid.addView(erase, keyBounds(keys.length(), preferredColumns));
    }
    private GridLayout.LayoutParams keyBounds(int keyIndex, int columns) {
        GridLayout.LayoutParams bounds = new GridLayout.LayoutParams();
        int slot = DeskGeometry.keypadSlot(keyIndex, columns);
        bounds.rowSpec = GridLayout.spec(slot / columns);
        bounds.columnSpec = GridLayout.spec(slot % columns, 1f);
        bounds.width = 0;
        bounds.height = -2;
        bounds.setMargins(dp(3),dp(4),dp(3),dp(4));
        return bounds;
    }
    private Button keypadButton(String key, String label, Runnable action) {
        Button button = new Button(this);
        button.setText(key);
        button.setContentDescription(label);
        DeskSurface.button(button,false);
        button.setTextSize(24);
        button.setOnClickListener(view -> {if(!busy)action.run();});
        return button;
    }
    private void prepare(JSONObject result, String code) throws Exception {
        JSONObject deposit=result.getJSONObject("deposit");
        if(result.isNull("claim_token")){note("Use the booth shown on the receipt.");return;}
        JSONObject available=deposit.getJSONObject("remaining");
        page("Prepare pickup","prepare",()->desk(code));
        String depositor=deposit.optString("depositor_label").trim();line("Depositor · "+(depositor.isEmpty()?"Name not recorded":depositor),21,true);
        String location=deposit.optString("location");
        if(!location.startsWith("Packet ")&&!location.startsWith("PKT-"))line(location,17,false);
        EditText collector=field("Collector name",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_WORDS,80);
        collector.setHint("Who is collecting these passes now?");
        JSONArray names=result.optJSONArray("collectors");
        if(names!=null&&names.length()>0){
            String[] choices=new String[names.length()+1];for(int i=0;i<names.length();i++)choices[i]=names.optString(i);choices[names.length()]="Enter another name";
            button("Choose a recorded collector",()->new AlertDialog.Builder(this).setTitle("Who is collecting now?").setItems(choices,(dialog,index)->{
                if(index<names.length())collector.setText(choices[index]);else{collector.setText("");collector.requestFocus();getSystemService(android.view.inputmethod.InputMethodManager.class).showSoftInput(collector,android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);}
            }).show(),false);
        }
        int[] selected=new int[KEYS.length];TextView[] values=new TextView[KEYS.length];
        for(int i=0;i<KEYS.length;i++){
            final int index=i,maximum=available.optInt(KEYS[i]);if(maximum==0)continue;
            LinearLayout row=new LinearLayout(this);row.setGravity(android.view.Gravity.CENTER_VERTICAL);
            LinearLayout controls=new LinearLayout(this);controls.setGravity(android.view.Gravity.END|android.view.Gravity.CENTER_VERTICAL);
            TextView label=new TextView(this);label.setText(LABELS[i]+" · "+maximum+" available");label.setTextSize(16);label.setTextColor(DeskSurface.INK);row.addView(label,new LinearLayout.LayoutParams(0,-2,1));
            TextView count=new TextView(this);count.setText("0");count.setTextSize(22);count.setTypeface(Typeface.MONOSPACE,Typeface.BOLD);count.setTextColor(DeskSurface.INK);count.setGravity(android.view.Gravity.CENTER);count.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);values[i]=count;
            controls.addView(stepButton("−","Decrease "+LABELS[i],()->setQuantity(selected,index,Math.max(0,selected[index]-1),count)),new LinearLayout.LayoutParams(dp(48),-2));
            int countWidth=Math.max(dp(48),(int)Math.ceil(count.getPaint().measureText(String.valueOf(maximum)))+dp(12));
            controls.addView(count,new LinearLayout.LayoutParams(countWidth,-2));
            controls.addView(stepButton("+","Increase "+LABELS[i],()->setQuantity(selected,index,Math.min(maximum,selected[index]+1),count)),new LinearLayout.LayoutParams(dp(48),-2));row.addView(controls);
            row.addOnLayoutChangeListener((view,left,top,right,bottom,oldLeft,oldTop,oldRight,oldBottom)->{
                float labelWidth=Math.max(label.getPaint().measureText(LABELS[index]),label.getPaint().measureText(maximum+" available"));
                boolean stacked=right-left<Math.ceil(labelWidth)+dp(104)+countWidth;
                int orientation=stacked?LinearLayout.VERTICAL:LinearLayout.HORIZONTAL;if(row.getOrientation()==orientation)return;
                row.setOrientation(orientation);label.setLayoutParams(new LinearLayout.LayoutParams(stacked?-1:0,-2,stacked?0:1));
                LinearLayout.LayoutParams bounds=new LinearLayout.LayoutParams(stacked?-1:-2,-2);if(stacked)bounds.topMargin=dp(8);controls.setLayoutParams(bounds);
            });
            LinearLayout.LayoutParams rowBounds=new LinearLayout.LayoutParams(-1,-2);rowBounds.topMargin=dp(8);content.addView(row,rowBounds);
        }
        button("Select all available",()->{for(int i=0;i<KEYS.length;i++)if(values[i]!=null)setQuantity(selected,i,available.optInt(KEYS[i]),values[i]);},false);
        line("Check the receipt and choose quantities. Reserve them before giving out any passes.",16,false);
        Button finish=button("Reserve selected passes",()->{
            try{String who=collector.getText().toString().trim();
                if(who.isEmpty()||who.length()>80||who.matches("(?s).*[\\x00-\\x1f\\x7f].*"))throw new IllegalArgumentException("Choose or enter the collector’s name.");
                JSONObject amounts=readQuantities(selected);
                JSONObject body=new JSONObject().put("packet_id",deposit.getString("packet_id")).put("claim_token",result.getString("claim_token")).put("version",deposit.getInt("version")).put("quantities",amounts).put("collector_label",who);
                run(()->client.stockChange("/api/deposits/"+deposit.getString("id")+"/release",body),this::stockResult);}
            catch(Exception error){note(error.getMessage());}
        },true);
        collector.addTextChangedListener(new TextWatcher(){
            public void beforeTextChanged(CharSequence value,int start,int count,int after){}
            public void onTextChanged(CharSequence value,int start,int before,int count){String who=value.toString().trim();finish.setText(who.isEmpty()?"Reserve selected passes":"Reserve passes for "+who);}
            public void afterTextChanged(Editable value){}
        });
    }
    private void speakDigits(String value){
        android.view.accessibility.AccessibilityManager access=getSystemService(android.view.accessibility.AccessibilityManager.class);
        if(!DeskSounds.enabled(this)||!speechReady||!value.matches("[0-9]{1,4}")||access!=null&&access.isTouchExplorationEnabled())return;
        speech.speak(value.replaceAll("(?<=.)(?=.)"," "),TextToSpeech.QUEUE_FLUSH,null,"sharepass-code");
    }
    private void logout(){
        new AlertDialog.Builder(this).setTitle("Log out of SharePass?").setNegativeButton("Stay",null)
            .setPositiveButton("Log out",(dialog,which)->run(()->{client.logout();return null;},result->{clearQueue();startActivity(new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));finish();})).show();
    }
    private void handover(JSONObject result) {
        JSONObject collection = result.optJSONObject("collection");
        if(collection==null||!"RELEASE_RECORDED".equals(collection.optString("status"))){
            if(collection!=null&&"HANDED_OVER".equals(collection.optString("status")))try{stockResult(result.put("action_path","/api/collections/history/handover"));}catch(Exception error){note(error.getMessage());}
            else note("Recover or refresh the reservation before giving out any passes.");return;
        }
        page("Hand over passes", "handover", this::desk);
        line("Depositor · "+firstNonEmpty(result.optJSONObject("deposit")==null?"":result.optJSONObject("deposit").optString("depositor_label"),"Name not recorded"),18,true);
        TextView quantities = line(balance(collection.optJSONObject("quantities")), 23, true);
        quantities.setBackground(DeskSurface.panel(this));
        quantities.setPadding(dp(14), dp(12), dp(14), dp(12));
        line("These passes are reserved. Hand them to the named collector, then hold below to confirm. If already received, do not give them again.", 17, false);
        line("Collector · "+firstNonEmpty(collection.optString("collector_label"),"Name not recorded on this older handover"),17,true);
        Button finish=button("Hold 2 seconds"+(collection.optString("collector_label").isEmpty()?" to confirm handover":" — confirm handover to "+collection.optString("collector_label")),()->{},true);
        handoverHold=new HoldButton(finish,handler,()->{if(busy||!foreground)throw new IllegalStateException("Wait for the current action.");return collection.toString();},()->run(() -> client.stockChange("/api/collections/" + collection.getString("id") + "/handover",
            new JSONObject().put("version", collection.getInt("version")).put("handover_confirmed", true)), this::stockResult),this::note);
    }
    private void pendingList(JSONObject result) throws Exception {
        JSONArray pending = result.getJSONArray("deposits");
        page("Pending handovers", "pending", this::desk);
        if (pending.length() == 0) line("There are no pending handovers.", 17, false);
        for (int i = 0; i < pending.length(); i++) {
            JSONObject deposit = pending.getJSONObject(i);
            JSONObject collection = deposit.getJSONObject("pending_collection");
            button(deposit.getString("location"), () -> run(() -> {
                client.resumeHandover(deposit, collection);
                return client.handover();
            }, this::handover), false);
        }
    }
    private void quantitySteps(Wizard wizard, int[] selected, JSONObject available) {
        wizard.steps.add((previous, next) -> {
            page(available == null ? "Count the passes" : "Choose passes for pickup", "quantity-step", previous);
            for (int i = 0; i < KEYS.length; i++) {
                final int index = i;
                String label = LABELS[i];
                int maximum = available == null ? 100 : available.optInt(KEYS[i]);
                if (maximum == 0) continue;
                LinearLayout stepper = new LinearLayout(this);
                stepper.setGravity(android.view.Gravity.CENTER_VERTICAL);
                TextView caption = new TextView(this);
                caption.setText(available == null ? label : label + " · " + maximum + " available");
                caption.setTextColor(DeskSurface.INK);
                caption.setTextSize(16);
                stepper.addView(caption, new LinearLayout.LayoutParams(0, -2, 2));
                TextView count = new TextView(this);
                count.setTextColor(DeskSurface.INK);
                count.setTextSize(22);
                count.setGravity(android.view.Gravity.CENTER);
                count.setTypeface(Typeface.MONOSPACE);
                count.setText(Integer.toString(selected[index]));
                count.setContentDescription(label + " quantity: " + selected[index]);
                count.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
                stepper.addView(stepButton("−", "Decrease " + label, () ->
                    setQuantity(selected, index, Math.max(0, selected[index] - 1), count)),
                    new LinearLayout.LayoutParams(dp(48), -2));
                stepper.addView(count, new LinearLayout.LayoutParams(dp(48), -2));
                stepper.addView(stepButton("+", "Increase " + label, () ->
                    setQuantity(selected, index, Math.min(maximum, selected[index] + 1), count)),
                    new LinearLayout.LayoutParams(dp(48), -2));
                content.addView(stepper);
            }
            if (available != null) button("Select all available", () -> {
                for (int i = 0; i < KEYS.length; i++) selected[i] = available.optInt(KEYS[i]);
                next.run();
            }, false);
            button(available==null?"Review deposit":"Review handover", () -> {
                try { readQuantities(selected); }
                catch (Exception error) { note(error.getMessage()); return; }
                next.run();
            }, true);
        });
    }
    private static void setQuantity(int[] quantities, int index, int value, TextView count) {
        quantities[index] = value;
        count.setText(Integer.toString(value));
        count.setContentDescription(LABELS[index] + " quantity: " + value);
    }
    private Button stepButton(String symbol, String description, Runnable change) {
        Button step = new Button(this);
        step.setText(symbol);
        step.setContentDescription(description);
        DeskSurface.button(step, false);
        step.setTextSize(22);
        step.setOnClickListener(view -> change.run());
        return step;
    }
    private JSONObject readQuantities(int[] counts) throws Exception {
        JSONObject quantities = new JSONObject();
        int total = 0;
        for (int i = 0; i < counts.length; i++) {
            int count = counts[i];
            if (!"mip".equals(KEYS[i]) || count > 0) quantities.put(KEYS[i], count);
            total += count;
        }
        if (total == 0) throw new IllegalArgumentException("Enter at least one pass.");
        return quantities;
    }
    private static String balance(JSONObject quantities) {
        if (quantities == null) return "No passes";
        StringBuilder balance = new StringBuilder();
        for (int i = 0; i < KEYS.length; i++) {
            if (quantities.optInt(KEYS[i]) == 0) continue;
            if (balance.length() > 0) balance.append(" · ");
            balance.append(quantities.optInt(KEYS[i])).append(" ").append(LABELS[i]);
        }
        return balance.length() == 0 ? "No passes" : balance.toString();
    }
    private void sharing(JSONObject receipt) {
        long expiry = receipt.optJSONObject("deposit").optLong("code_expires_at");
        if (expiry > 0 && expiry <= System.currentTimeMillis()) {
            page("Share code", "sharing", () -> receipt(receipt));
            note("This collection code has expired.");
            return;
        }
        String code = receipt.optString("collection_code");
        String packet = receipt.optJSONObject("deposit").optString("packet_id");
        if (!code.equals(sharingCode) || !packet.equals(sharingPacket)) {
            recipients.clear();
            JSONArray savedPeople = receipt.optJSONArray("recipients");
            for (int i = 0; savedPeople != null && i < savedPeople.length(); i++) {
                JSONObject saved = savedPeople.optJSONObject(i);
                if (saved == null) continue;
                Recipient recipient = new Recipient();
                recipient.name = saved.optString("name");
                recipient.quantities = saved.opt("quantities");
                try {
                    recipient.phone = "+" + WhatsAppDraft.phone(saved.optString("phone"));
                    recipients.add(recipient);
                } catch (IllegalArgumentException invalid) {
                    // Keep an explicit plan available for contact repair, never drop it on a later save.
                    if (recipient.quantities != null) {
                        recipient.phone = saved.optString("phone");
                        recipients.add(recipient);
                    }
                    // Earlier unallocated receipts may have email-only contacts.
                }
            }
            if (recipients.isEmpty()) recipients.add(new Recipient());
            sharingCode = code;
            sharingPacket = packet;
        }
        if (recipients.isEmpty()) recipients.add(new Recipient());
        if (recipients.get(0).phone.isEmpty()) editRecipient(receipt, 0);
        else sharingPerson(receipt, 0);
    }
    private void sharingPerson(JSONObject receipt, int index) {
        page("Share by WhatsApp", "sharing", () -> receipt(receipt));
        Recipient recipient = recipients.get(index);
        line(recipient.name.isEmpty() ? "Recipient " + (index + 1) : recipient.name, 24, true);
        if (!recipient.phone.isEmpty()) {
            line(recipient.phone, 17, false);
            button("Show WhatsApp QR", () -> sharingQr(receipt, index), true);
            messageButton(recipient.name, () -> run(()->freshSharingReceipt(receipt),current->compose(recipient.phone,depositMessage(current,recipient))));
        }
        button(recipient.phone.isEmpty() ? "Enter WhatsApp number" : "Edit recipient",
            () -> editRecipient(receipt, index), recipient.phone.isEmpty());
        if (index > 0) button("Previous recipient", () -> sharingPerson(receipt, index - 1), false);
        if (index < recipients.size() - 1) button("Next recipient", () -> sharingPerson(receipt, index + 1), false);
        if (recipients.size() < 20) button("Add recipient", () -> {
            recipients.add(new Recipient());
            editRecipient(receipt, recipients.size() - 1);
        }, false);
    }
    private void editRecipient(JSONObject receipt, int index) {
        Recipient recipient = recipients.get(index);
        page("WhatsApp recipient", "recipient", () -> {
            sharingPerson(receipt, index);
        });
        EditText name = field("Recipient name (optional)", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS, 80);
        name.setText(recipient.rawName==null?recipient.name:recipient.rawName);
        EditText phone = field("Recipient WhatsApp number", InputType.TYPE_CLASS_PHONE, 40);
        phone.setHint("10-digit mobile or international + code");
        phone.setText(recipient.rawPhone==null?recipient.phone:recipient.rawPhone);
        TextWatcher preserve=new TextWatcher(){
            public void beforeTextChanged(CharSequence value,int start,int count,int after){}
            public void onTextChanged(CharSequence value,int start,int before,int count){recipient.rawName=name.getText().toString();recipient.rawPhone=phone.getText().toString();}
            public void afterTextChanged(Editable value){}
        };
        name.addTextChangedListener(preserve);phone.addTextChangedListener(preserve);
        Runnable prepare = () -> {
            try {
                recipient.phone = "+" + WhatsAppDraft.phone(phone.getText().toString());
                recipient.name = name.getText().toString().trim();
                rememberRecipients(receipt, () -> sharingPerson(receipt, index));
            } catch (IllegalArgumentException error) { phone.setError(error.getMessage()); }
        };
        button("Prepare WhatsApp", prepare, true);
        autoAdvance(phone, WhatsAppDraft::complete, prepare);
        if (!recipient.phone.isEmpty()) button("Remove recipient", () -> {
            recipients.remove(index);
            rememberRecipients(receipt, () -> {
                if (recipients.isEmpty()) receipt(receipt);
                else sharingPerson(receipt, Math.max(0, index - 1));
            });
        }, false);
    }
    private void rememberRecipients(JSONObject receipt, Runnable next) {
        run(() -> {
            JSONArray people = new JSONArray();
            for (Recipient recipient : recipients) {
                if (!recipient.phone.isEmpty() || recipient.quantities != null) {
                    JSONObject person = new JSONObject().put("name", recipient.name).put("phone", recipient.phone);
                    if (recipient.quantities != null) person.put("quantities", recipient.quantities);
                    people.put(person);
                }
            }
            client.rememberRecipients(receipt.getString("collection_code"), people);
            return null;
        }, result -> next.run());
    }
    private String depositMessage(JSONObject receipt, Recipient recipient) throws Exception {
        JSONObject quantities = receipt.getJSONObject("deposit").getJSONObject("remaining");
        Map<String,Object> counts = draftCounts(quantities);
        Map<String,Object> allocation = null;
        if (recipient.quantities != null) {
            if (!(recipient.quantities instanceof JSONObject)) throw new IllegalArgumentException("Review the recipient’s planned share");
            allocation = draftCounts((JSONObject) recipient.quantities);
        }
        return WhatsAppDraft.message(receipt.getString("collection_code"), "", context.optString("booth_label","Box office"),
            context.optString("pickup_location"), counts, recipient.name, receipt.getJSONObject("deposit").optString("packet_id"), allocation,HostedRegisterClient.ORIGIN,receipt.getJSONObject("deposit").optLong("code_expires_at"));
    }
    private static Map<String,Object> draftCounts(JSONObject quantities) {
        Map<String,Object> counts = new LinkedHashMap<>();
        // Keep the original values for strict validation instead of optInt coercion.
        java.util.Iterator<String> keys = quantities.keys();
        while (keys.hasNext()) { String key = keys.next(); counts.put(key, quantities.opt(key)); }
        return counts;
    }
    private void compose(String address, String message) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(WhatsAppDraft.url(address, message))));
        } catch (android.content.ActivityNotFoundException error) {
            note("No app is available to open this WhatsApp draft.");
        } catch (IllegalArgumentException error) { note(error.getMessage()); }
    }
    private void sharingQr(JSONObject receipt, int index) {
        run(()->freshSharingReceipt(receipt),current->showSharingQr(current,index));
    }
    private JSONObject freshSharingReceipt(JSONObject previous) throws Exception {
        JSONObject old=previous.getJSONObject("deposit"),current=client.openReceipt(old.getString("id")),deposit=current.getJSONObject("deposit");
        if(!old.getString("id").equals(deposit.getString("id"))||!old.getString("packet_id").equals(deposit.getString("packet_id"))||!previous.getString("collection_code").equals(current.getString("collection_code")))throw new IllegalArgumentException("The receipt changed. Open its current receipt before sharing.");
        if(deposit.optBoolean("handover_pending")||deposit.optJSONObject("pending_collection")!=null||deposit.optLong("code_expires_at")<=System.currentTimeMillis()||!hasAvailable(deposit.getJSONObject("remaining")))throw new IllegalArgumentException("This receipt is not available for collection. Check its current status with staff.");
        return current;
    }
    private void showSharingQr(JSONObject receipt, int index) {
        Recipient recipient = recipients.get(index);
        String label = recipient.name.isEmpty() ? "Recipient " + (index + 1) : recipient.name;
        page("WhatsApp · " + label, "share-qr", () -> sharingPerson(receipt, index));
        try {
            line(receipt.getString("collection_code"), 36, true);
            showQr(WhatsAppDraft.url(recipient.phone, depositMessage(receipt, recipient)), "WhatsApp message QR for " + label);
        } catch (Exception error) { note(error.getMessage()); }
    }
}
