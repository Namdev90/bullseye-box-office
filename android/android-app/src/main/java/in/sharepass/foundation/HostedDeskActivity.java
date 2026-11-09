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
    private static final String[] KEYS = {"normal", "vip", "vvip", "mip"};
    private static final String[] LABELS = {"Normal", "VIP", "VVIP", "MIP"};
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService polling = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable intakePoll = this::checkIntake;
    private final Runnable queuePoll = this::checkQueue;
    private final Runnable slowAction = () -> note("Working…");
    private final HashSet<String> seenQueue = new HashSet<>();
    private HostedRegisterClient client;
    private JSONObject context;
    private LinearLayout content;
    private DeskWindow viewport;
    private TextView status;
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
    private boolean collectPane, manualQueueRefresh;
    private String deskCode = "";
    private EditText deskInput;
    private float deskTouchX, deskTouchY;
    private boolean deskSwipeStarted;
    private final ArrayList<Recipient> recipients = new ArrayList<>();
    private String sharingCode;

    private static final class Recipient {
        String name = "", phone = "";
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
        QueuePush.listen(() -> handler.post(() -> scheduleQueue(0)));
        if (context != null && !context.optString("staff_label", "").isEmpty() && !context.isNull("staff_label")) {
            QueuePush.sync(this, client.token());
        }
        scheduleIntake(0);
        scheduleQueue(0);
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
        foreground = false;
        QueuePush.counterVisible(false);
        QueuePush.listen(null);
        handler.removeCallbacks(intakePoll);
        handler.removeCallbacks(queuePoll);
        super.onPause();
    }
    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        releaseQr();
        worker.shutdown();
        polling.shutdown();
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
        if (deskInput != null) deskCode = deskInput.getText().toString();
        View focused = getCurrentFocus();
        if (focused instanceof EditText) {
            getSystemService(android.view.inputmethod.InputMethodManager.class)
                .hideSoftInputFromWindow(focused.getWindowToken(), 0);
            focused.clearFocus();
        }
        releaseQr();
        handler.removeCallbacks(intakePoll);
        screen = name;
        deskInput = null;
        back = goBack;
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        queueButton = null;
        queueRows = null;
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int sidePadding = dp(14);
        content.setPadding(sidePadding, dp(12), sidePadding, dp(24));
        scroll.addView(content);
        if (viewport == null) {
            viewport = new DeskWindow(this);
            setContentView(viewport);
        }
        viewport.show(scroll, 680);
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        if (goBack != null) {
            Button previous = new Button(this);
            previous.setText("‹");
            previous.setContentDescription("Back");
            DeskSurface.roundButton(previous);
            previous.setOnClickListener(view -> goBack());
            toolbar.addView(previous, new LinearLayout.LayoutParams(dp(48), dp(48)));
        }
        TextView label = new TextView(this);
        String booth = boothLabel();
        label.setText(booth.isEmpty() ? "SHAREPASS" : "SHAREPASS   /   " + booth);
        label.setTextColor(DeskSurface.BRASS);
        label.setTextSize(11);
        label.setTypeface(Typeface.DEFAULT_BOLD);
        label.setLetterSpacing(.12f);
        label.setPadding(goBack == null ? 0 : dp(12), 0, dp(12), 0);
        int labelIndex = toolbar.getChildCount();
        toolbar.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
        View spacer = new View(this);
        spacer.setVisibility(View.GONE);
        toolbar.addView(spacer, new LinearLayout.LayoutParams(0, 0, 1));
        if ("desk".equals(name)) {
            Button account = new Button(this);
            account.setText("Account");
            DeskSurface.button(account, false);
            account.setOnClickListener(view -> deskOptions());
            toolbar.addView(account, new LinearLayout.LayoutParams(-2, -2));
        } else if (!"opening".equals(name)) {
            Button help = new Button(this);
            help.setText("?");
            help.setContentDescription("Help for " + title);
            DeskSurface.roundButton(help);
            help.setOnClickListener(view -> new AlertDialog.Builder(this).setTitle(title)
                .setMessage(helpText(title, name)).setPositiveButton("Got it", null).show());
            toolbar.addView(help, new LinearLayout.LayoutParams(dp(48), dp(48)));
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
        content.addView(header);
        content.addView(DeskSurface.perforation(this), new LinearLayout.LayoutParams(-1, dp(15)));
        TextView heading = line(title, 32, true);
        heading.setTypeface(Typeface.create("sans-serif-black", Typeface.NORMAL));
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
            case "Custom code (optional)" -> "Use four letters or numbers. Leave it blank to let SharePass choose an unused code.";
            case "Code lifetime (optional)" -> "Choose between 5 minutes and 2 days. Leave it blank for the register's default.";
            case "Confirm receipt" -> "Confirm after the customer's physical passes are in your hands.";
            case "Collect passes" -> "Enter the four characters the collector shares. Looking up the code does not release passes.";
            case "Prepare pickup", "Hand over passes" -> "Check the physical packet label and pass counts before confirming the handover.";
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
        size.topMargin = dp(9);
        content.addView(button, size);
        button.setOnClickListener(view -> { if (!busy) action.run(); });
        return button;
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
            if (foreground && !busy && field.isAttachedToWindow() && field.hasFocus()
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
        note(message == null || message.isEmpty() ? "SharePass could not finish this action." : message);
    }
    private void run(Work action, Done done) {
        if (busy) return;
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
        button("Use a setup QR link", this::pairingLink, false);
        button("Owner sign-in", this::openAdminAccount, false);
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
        button("Connect phone", () -> run(() -> client.connectDevice("invite", invite), this::connected), true);
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
        collectPane = true;
        deskCode = code;
        desk();
    }
    private void desk() {
        recipients.clear();
        sharingCode = null;
        page("Pass desk", "desk", this::finish);
        if (client.hasPending()) {
            button("Recover last action", () -> run(client::recover, this::stockResult), true);
            return;
        }
        if (client.handover() != null) {
            button("Resume handover", () -> handover(client.handover()), true);
            return;
        }
        if (!boothLabel().isEmpty()) line(boothLabel(), 16, false);
        LinearLayout tabs = new LinearLayout(this);
        Button depositTab = new Button(this);
        Button collectTab = new Button(this);
        depositTab.setText("Deposit");
        collectTab.setText("Collect");
        depositTab.setSelected(!collectPane);
        collectTab.setSelected(collectPane);
        DeskSurface.button(depositTab, !collectPane);
        DeskSurface.button(collectTab, collectPane);
        tabs.addView(depositTab, new LinearLayout.LayoutParams(0, -2, 1));
        tabs.addView(collectTab, new LinearLayout.LayoutParams(0, -2, 1));
        depositTab.setOnClickListener(view -> switchDeskPane(false));
        collectTab.setOnClickListener(view -> switchDeskPane(true));
        content.addView(tabs);
        button("Refresh / reconnect", this::refreshQueueNow, false);
        content.addView(DeskSurface.perforation(this), new LinearLayout.LayoutParams(-1, dp(14)));
        if (collectPane) {
            line("Collect passes", 27, true);
            collectionEntry(deskCode);
        } else {
            line("Deposit passes", 27, true);
            line("Let the depositor scan the form. Review it when it reaches the queue.", 16, false);
            LinearLayout depositView = content;
            int qrPosition = depositView.getChildCount();
            polling.execute(() -> {
                try {
                    String url = boothPosterUrl(client.request("/api/booth", null));
                    runOnUiThread(() -> {
                        if (isDestroyed() || content != depositView || collectPane || !"desk".equals(screen)) return;
                        try {
                            showQr(url, "QR for the depositor to fill in");
                            depositView.removeView(qr);
                            depositView.addView(qr, qrPosition, qrBounds());
                        } catch (Exception error) { note("Open the full-size deposit QR to retry."); }
                    });
                } catch (Exception ignored) { /* The full-size QR button can retry. */ }
            });
            button("Show full-size deposit QR", () -> run(() -> client.request("/api/booth", null), this::boothPoster), true);
            queueButton = button(queueLabel(), this::queue, false);
            queueButton.setCompoundDrawablesWithIntrinsicBounds(R.drawable.ic_ticket_layers, 0, 0, 0);
        }
    }
    private void switchDeskPane(boolean collecting) {
        if (busy || collectPane==collecting) return;
        if (deskInput!=null) deskCode=deskInput.getText().toString();
        collectPane=collecting;
        desk();
    }
    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        if ("desk".equals(screen) && !busy && client!=null && !client.hasPending() && client.handover()==null) {
            if (event.getActionMasked()==MotionEvent.ACTION_DOWN) {
                deskTouchX=event.getX();deskTouchY=event.getY();
                deskSwipeStarted=viewport.contains(deskTouchX,deskTouchY);
            } else if (event.getActionMasked()==MotionEvent.ACTION_CANCEL) {
                deskSwipeStarted=false;
            } else if (event.getActionMasked()==MotionEvent.ACTION_UP && deskSwipeStarted) {
                deskSwipeStarted=false;
                float dx=event.getX()-deskTouchX,dy=event.getY()-deskTouchY;
                if (Math.abs(dx)>dp(64) && Math.abs(dx)>1.6f*Math.abs(dy) && (dx<0)!=collectPane) {
                    MotionEvent cancel=MotionEvent.obtain(event);
                    cancel.setAction(MotionEvent.ACTION_CANCEL);
                    super.dispatchTouchEvent(cancel);
                    cancel.recycle();
                    switchDeskPane(dx<0);
                    return true;
                }
            }
        }
        return super.dispatchTouchEvent(event);
    }
    private void deskOptions() {
        page("Account and settings", "desk-options", this::desk);
        line("Staff · " + context.optString("staff_label", "Counter"), 18, true);
        if (!context.isNull("designation")) line(context.optString("designation"), 16, false);
        button("Administrator sign-in", this::openAdminAccount, false);
        JSONObject outstanding = client.intake();
        if (outstanding != null && outstanding.optLong("expires_at") > System.currentTimeMillis()) {
            button("Resume deposit", () -> {
                try { intake(outstanding); } catch (Exception error) { failed(error); }
            }, false);
        } else button("One-time deposit QR", () -> run(client::startIntake, this::intake), false);
        if (client.receipt() != null) button("Last deposit", () -> receipt(client.receipt()), false);
        button("Check pending handovers", () -> run(() -> client.request("/api/state", null), this::pendingList), false);
        button(notificationsAllowed() ? "Alert and sound settings" : "Enable booth alerts",
            notificationsAllowed() ? this::openAlertSettings : this::askNotificationPermission, false);
        button("Sign out", () -> new AlertDialog.Builder(this).setMessage("Sign out of SharePass on this phone?")
            .setNegativeButton("Stay", null).setPositiveButton("Sign out", (dialog, which) ->
                run(() -> { client.logout(); return null; }, result -> { clearQueue(); login(); })).show(), false);
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
        collectPane = false;
        manualQueueRefresh = false;
        deskCode = "";
        requestedQueue = false;
        queueBaseline = false;
        seenQueue.clear();
        queueDrafts = new JSONArray();
        handler.removeCallbacks(queuePoll);
        QueueNotifications.cancel(this);
    }
    private void refreshQueueNow() {
        manualQueueRefresh=true;
        note("Connecting…");
        scheduleQueue(0);
    }
    private void scheduleQueue(long delay) {
        if (delay>=2000 && context!=null && context.optBoolean("push_first")) return;
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
            if (!"queue".equals(screen)) queue();
        }
        checkingQueue = true;
        String session = client.token();
        polling.execute(() -> {
            try {
                JSONArray drafts = client.request("/api/queue", null).getJSONArray("drafts");
                runOnUiThread(() -> {
                    checkingQueue = false;
                    if (isDestroyed() || !foreground || context == null || !session.equals(client.token())) return;
                    HashSet<String> waiting = new HashSet<>();
                    for (int i = 0; i < drafts.length(); i++) {
                        JSONObject draft = drafts.optJSONObject(i);
                        String token = draft == null ? "" : draft.optString("token");
                        if (validQueueToken(token)) waiting.add(token);
                    }
                    int newCount = 0;
                    for (String token : waiting) if (!seenQueue.contains(token)) newCount++;
                    seenQueue.clear();
                    seenQueue.addAll(waiting);
                    if (queueBaseline && newCount > 0) QueueNotifications.show(this, newCount);
                    if (waiting.isEmpty()) QueueNotifications.cancel(this);
                    queueBaseline = true;
                    queueDrafts = drafts;
                    if (queueButton != null) queueButton.setText(queueLabel());
                    if (queueRows != null && !busy) renderQueueRows();
                    if (manualQueueRefresh) {
                        manualQueueRefresh=false;
                        if ("desk".equals(screen) || "queue".equals(screen)) note("Connected. " + waiting.size() + " waiting.");
                    } else if (queueRows != null && !busy) note("");
                    scheduleQueue(3500);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    checkingQueue = false;
                    if (isDestroyed() || !foreground || context == null || !session.equals(client.token())) return;
                    if (error instanceof HostedRegisterClient.Rejected && ((HostedRegisterClient.Rejected) error).status == 401) {
                        if (!busy) failed(error);
                    } else if (queueRows != null || manualQueueRefresh) note("Could not reconnect. Try Refresh / reconnect again.");
                    manualQueueRefresh=false;
                    scheduleQueue(7000);
                });
            }
        });
    }
    private static boolean validQueueToken(String token) { return token.matches("[a-f0-9-]{36}"); }
    private boolean notificationsAllowed() {
        return QueueNotifications.allowed(this);
    }
    private void openAlertSettings() {
        QueueNotifications.ensureChannel(this);
        Intent settings;
        if (Build.VERSION.SDK_INT >= 26) {
            settings = new Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName())
                .putExtra(android.provider.Settings.EXTRA_CHANNEL_ID, QueueNotifications.CHANNEL);
        } else settings = new Intent(android.provider.Settings.ACTION_SOUND_SETTINGS);
        startActivity(settings);
    }
    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, QueueNotifications.NOTICE_ID);
        } else openAlertSettings();
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == QueueNotifications.NOTICE_ID && "desk".equals(screen)) {
            QueuePush.sync(this, client.token());
            if (notificationsAllowed()) { deskOptions(); note("Booth alerts are on while SharePass is open."); }
            else note("Booth alerts are off. The queue still updates here.");
        }
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
        page("Booth queue", "queue", this::desk);
        button("Customer form QR", () -> run(() -> client.request("/api/booth", null), this::boothPoster), false);
        line("Match the customer and count their passes.", 16, false);
        if (context.optBoolean("push_first")) button("Refresh / reconnect", this::refreshQueueNow, false);
        queueRows = new LinearLayout(this);
        queueRows.setOrientation(LinearLayout.VERTICAL);
        content.addView(queueRows);
        queueSnapshot = "";
        renderQueueRows();
        scheduleQueue(0);
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
            Button item = new Button(this);
            item.setText(draft.optString("name", "Customer") + " · " + draft.optString("queue_ref")
                + "\n" + balance(draft.optJSONObject("quantities")));
            DeskSurface.button(item, false);
            item.setGravity(android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL);
            LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(-1, -2);
            size.topMargin = dp(10);
            queueRows.addView(item, size);
            item.setOnClickListener(view -> run(() -> client.request("/api/queue/" + token, null), value -> queueReview(token, value)));
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
        page("Match the customer and passes", "queue-review", this::queue);
        line(draft.optString("name") + " · " + draft.optString("queue_ref"), 22, true);
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
        button("Refresh code suggestion", () -> run(() -> client.request("/api/codes/suggest?exclude=" + suggested, null),
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
        wizard.text("Custom code (optional)", draft.code, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS,
            4, "Four letters or numbers", (value, validate) -> {
                draft.code = value.toUpperCase(Locale.ROOT);
                return validate && !draft.code.isEmpty() && !draft.code.matches("[A-Z0-9]{4}")
                    ? "Enter four letters or numbers" : null;
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
        qr = QrPreview.create(this, value, label, viewport::paneHeight);
        content.addView(qr, qrBounds());
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    private LinearLayout.LayoutParams qrBounds() {
        LinearLayout.LayoutParams bounds = new LinearLayout.LayoutParams(-2, -2);
        bounds.gravity = android.view.Gravity.CENTER_HORIZONTAL;
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
                        } else scheduleIntake(2000);
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
                    } else scheduleIntake(5000);
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
        String path = result.getString("action_path");
        if (path.startsWith("/api/queue/") && context.optBoolean("push_first")) scheduleQueue(0);
        if (path.endsWith("/release")) handover(result);
        else if (path.endsWith("/handover")) {
            page("Passes handed over", "done", this::desk);
            line("Remaining · " + balance(result.getJSONObject("deposit").getJSONObject("remaining")), 19, true);
            JSONObject update=result.optJSONObject("depositor_update");
            if (update != null && "whatsapp".equals(update.optString("channel"))) {
                button("Open depositor WhatsApp draft", () -> compose(
                    update.optString("address"), update.optString("message")), true);
            }
            button("Done", this::desk, true);
        } else receipt(result);
    }
    private void receipt(JSONObject result) {
        page("Passes deposited", "receipt", this::desk);
        line("Collection code", 16, false);
        TextView code = line(result.optString("collection_code"), 44, true);
        code.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        code.setTextColor(DeskSurface.BRASS);
        JSONObject deposit = result.optJSONObject("deposit");
        line("Packet label · " + deposit.optString("packet_id"), 17, false);
        if (deposit.optLong("code_expires_at") > 0) {
            String time = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT)
                .format(new java.util.Date(deposit.optLong("code_expires_at")));
            line("Code expires " + time, 15, false);
        }
        JSONObject proof = result.optJSONObject("depositor_receipt");
        if (proof != null) button("Send receipt to depositor", () -> compose(proof.optString("address"), proof.optString("message")), true);
        button("Share code", () -> sharing(result), true);
        button("Pickup updates", () -> pickupPreferences(result), false);
        if (context.optBoolean("ticket_receipts")) button("Refresh code", () -> refreshCode(result), false);
        button("Done", this::desk, false);
    }
    private void refreshCode(JSONObject result) {
        page("Refresh collection code", "refresh-code", () -> receipt(result));
        line("Match the physical packet. The previous code will stop working. Share the replacement.", 17, false);
        EditText packet = field("Physical packet label", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS, 12);
        button("Confirm refresh", () -> {
            String value = packet.getText().toString().trim().toUpperCase(Locale.ROOT);
            if (!value.matches("PKT-[A-F0-9]{8}")) { packet.setError("Enter the physical packet label"); return; }
            run(() -> client.stockChange("/api/codes/refresh", new JSONObject().put("packet_id", value)
                .put("collection_code", result.getString("collection_code"))), this::stockResult);
        }, true);
    }
    private void pickupPreferences(JSONObject receipt) {
        page("WhatsApp pickup updates", "pickup-updates", () -> receipt(receipt));
        if ("whatsapp".equals(receipt.optString("update_channel"))) line("WhatsApp updates are on.", 16, false);
        EditText input = field("Depositor WhatsApp number", InputType.TYPE_CLASS_PHONE, 40);
        input.setHint("10-digit mobile or international + code");
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
            client.rememberUpdateChannel(result.optString("update_channel"));
            return result;
        }, result -> receipt(client.receipt()));
    }
    private void collectionEntry(String initial) {
        EditText input = field("Collection code", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS, 4);
        input.setText(initial);
        input.setHint("AB12");
        input.setTextSize(26);
        input.setShowSoftInputOnFocus(false);
        deskInput = input;
        Runnable find = () -> {
            String code = input.getText().toString().trim().toUpperCase(Locale.ROOT);
            if (!code.matches("[A-Z0-9]{4}")) { input.setError("Enter the four-character code"); return; }
            deskCode = code;
            verifyPickup(code, "");
        };
        button("Find passes", find, true);
        autoAdvance(input, value -> value.matches("[A-Za-z0-9]{4}"), find);
        LinearLayout keypad = new LinearLayout(this);
        keypad.setOrientation(LinearLayout.VERTICAL);
        content.addView(keypad);
        drawKeypad(keypad, input, false);
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
        line("Enter the pickup reference shown on the collector’s current receipt or WhatsApp message.", 17, false);
        EditText reference = field("Pickup reference", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS, 12);
        reference.setHint("PKT-1234ABCD");
        Runnable check = () -> {
            String value = reference.getText().toString().trim().toUpperCase(Locale.ROOT);
            if (!value.matches("PKT-[A-F0-9]{8}")) { reference.setError("Enter the pickup reference"); return; }
            verifyPickup(code, value);
        };
        button("Find passes", check, true);
    }
    private void drawKeypad(LinearLayout keypad, EditText input, boolean letters) {
        keypad.removeAllViews();
        String keys = letters ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ" : "1234567890";
        int preferredColumns = letters ? 5 : 3;
        GridLayout keysGrid = new GridLayout(this);
        keysGrid.setColumnCount(preferredColumns);
        keypad.addView(keysGrid, new LinearLayout.LayoutParams(-1, -2));
        keysGrid.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            int columns = DeskGeometry.keypadColumns(right - left, dp(48), preferredColumns);
            if (keysGrid.getColumnCount() == columns) return;
            // Clear GridLayout's resolved indices before reducing its column count.
            keysGrid.setColumnCount(GridLayout.UNDEFINED);
            for (int i=0; i<keysGrid.getChildCount(); i++) keysGrid.getChildAt(i).setLayoutParams(keyBounds());
            keysGrid.setColumnCount(columns);
        });
        for (int i=0; i<keys.length(); i++) {
            String key=keys.substring(i,i+1);
            Button button = keypadButton(key,key,() -> {
                input.requestFocus();
                if (input.length()<4) { input.append(key);input.setSelection(input.length()); }
            });
            keysGrid.addView(button, keyBounds());
        }
        LinearLayout controls = new LinearLayout(this);
        keypad.addView(controls);
        addKey(controls,letters?"123":"ABC",letters?"Show numbers":"Show letters",() -> drawKeypad(keypad,input,!letters));
        addKey(controls,"⌫","Delete last character",() -> {
            input.requestFocus();
            if (input.length()>0) input.getText().delete(input.length()-1,input.length());
        });
    }
    private GridLayout.LayoutParams keyBounds() {
        GridLayout.LayoutParams bounds = new GridLayout.LayoutParams();
        bounds.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
        bounds.width = 0;
        bounds.height = dp(50);
        return bounds;
    }
    private void addKey(LinearLayout row, String key, String label, Runnable action) {
        row.addView(keypadButton(key,label,action),new LinearLayout.LayoutParams(0,dp(50),1));
    }
    private Button keypadButton(String key, String label, Runnable action) {
        Button button = new Button(this);
        button.setText(key);
        button.setContentDescription(label);
        DeskSurface.button(button,false);
        button.setOnClickListener(view -> {if(!busy)action.run();});
        return button;
    }
    private void prepare(JSONObject result, String code) throws Exception {
        JSONObject deposit = result.getJSONObject("deposit");
        if (result.isNull("claim_token")) { note("This packet cannot be collected at this counter."); return; }
        JSONObject available = deposit.getJSONObject("remaining");
        String packetId = deposit.getString("packet_id");
        String[] packet = {""};
        int[] selected = new int[KEYS.length];
        Wizard wizard = new Wizard(() -> desk(code), () -> {});
        String location = deposit.getString("location");
        if (!location.startsWith("Packet ")) wizard.review("Find the packet", "Storage reference · " + location, "Next");
        wizard.text("Match the packet label", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS, 40, "", (value, validate) -> {
            packet[0] = value;
            return validate && !value.equalsIgnoreCase(packetId) ? "The packet label does not match" : null;
        }, Collections.emptyMap(), value -> value.trim().equalsIgnoreCase(packetId));
        quantitySteps(wizard, selected, available);
        wizard.steps.add((previous, next) -> {
            page("Prepare pickup", "prepare", previous);
            try {
                JSONObject amounts = readQuantities(selected);
                line(balance(amounts), 21, true);
                button("Prepare handover", () -> run(() -> client.stockChange("/api/deposits/" + deposit.getString("id") + "/release",
                    new JSONObject().put("packet_id", packet[0]).put("claim_token", result.getString("claim_token"))
                        .put("version", deposit.getInt("version")).put("quantities", amounts)), this::stockResult), true);
            } catch (Exception error) { note(error.getMessage()); }
        });
        wizard.start();
    }
    private void handover(JSONObject result) {
        JSONObject collection = result.optJSONObject("collection");
        page("Hand over passes", "handover", this::desk);
        line(balance(collection.optJSONObject("quantities")), 21, true);
        line("Confirm only after the collector has the passes. If they already received them, confirm without handing them over again.", 17, false);
        button("Confirm handover", () -> run(() -> client.stockChange("/api/collections/" + collection.getString("id") + "/handover",
            new JSONObject().put("version", collection.getInt("version")).put("handover_confirmed", true)), this::stockResult), true);
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
        if (!code.equals(sharingCode)) {
            recipients.clear();
            JSONArray savedPeople = receipt.optJSONArray("recipients");
            for (int i = 0; savedPeople != null && i < savedPeople.length(); i++) {
                JSONObject saved = savedPeople.optJSONObject(i);
                if (saved == null) continue;
                Recipient recipient = new Recipient();
                recipient.name = saved.optString("name");
                try {
                    recipient.phone = "+" + WhatsAppDraft.phone(saved.optString("phone"));
                    recipients.add(recipient);
                } catch (IllegalArgumentException invalid) {
                    // Earlier receipts may have email-only contacts.
                }
            }
            if (recipients.isEmpty()) recipients.add(new Recipient());
            sharingCode = code;
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
            button("Open WhatsApp draft", () -> {
                try { compose(recipient.phone, depositMessage(receipt, recipient)); }
                catch (Exception error) { note(error.getMessage()); }
            }, false);
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
            if (!recipient.phone.isEmpty()) sharingPerson(receipt, index);
            else if (recipients.size() > 1) {
                recipients.remove(index);
                sharingPerson(receipt, Math.max(0, index - 1));
            } else receipt(receipt);
        });
        EditText name = field("Recipient name (optional)", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS, 80);
        name.setText(recipient.name);
        EditText phone = field("Recipient WhatsApp number", InputType.TYPE_CLASS_PHONE, 40);
        phone.setHint("10-digit mobile or international + code");
        phone.setText(recipient.phone);
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
                if (!recipient.phone.isEmpty()) people.put(new JSONObject().put("name", recipient.name).put("phone", recipient.phone));
            }
            client.rememberRecipients(receipt.getString("collection_code"), people);
            return null;
        }, result -> next.run());
    }
    private String depositMessage(JSONObject receipt, Recipient recipient) throws Exception {
        JSONObject quantities = receipt.getJSONObject("deposit").getJSONObject("remaining");
        Map<String,Integer> counts = new LinkedHashMap<>();
        for (String key : KEYS) counts.put(key, quantities.optInt(key));
        return WhatsAppDraft.message(receipt.getString("collection_code"), "", context.optString("booth_label","Box office"),
            context.optString("pickup_location"), counts, recipient.name, receipt.getJSONObject("deposit").optString("packet_id"));
    }
    private void compose(String address, String message) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(WhatsAppDraft.url(address, message))));
        } catch (android.content.ActivityNotFoundException error) {
            note("No app is available to open this WhatsApp draft.");
        } catch (IllegalArgumentException error) { note(error.getMessage()); }
    }
    private void sharingQr(JSONObject receipt, int index) {
        Recipient recipient = recipients.get(index);
        String label = recipient.name.isEmpty() ? "Recipient " + (index + 1) : recipient.name;
        page("WhatsApp · " + label, "share-qr", () -> sharingPerson(receipt, index));
        try {
            line(receipt.getString("collection_code"), 36, true);
            line("Pickup reference · " + receipt.getJSONObject("deposit").getString("packet_id"), 17, false);
            showQr(WhatsAppDraft.url(recipient.phone, depositMessage(receipt, recipient)), "WhatsApp message QR for " + label);
        } catch (Exception error) { note(error.getMessage()); }
    }
}
