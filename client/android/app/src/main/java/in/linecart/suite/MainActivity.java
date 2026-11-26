package in.linecart.suite;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // App-local plugins: fresh GPS fix + mock-location flag, and Keystore-backed session token store
        registerPlugin(LocationIntegrityPlugin.class);
        registerPlugin(SessionStoragePlugin.class);
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        if (window != null) {
            View decorView = window.getDecorView();
            decorView.setBackgroundColor(Color.WHITE);
            window.setStatusBarColor(Color.WHITE);
            window.setNavigationBarColor(Color.WHITE);

            WindowInsetsControllerCompat insetsController =
                WindowCompat.getInsetsController(window, decorView);
            if (insetsController != null) {
                insetsController.show(WindowInsetsCompat.Type.systemBars());
                insetsController.setAppearanceLightStatusBars(true);
                insetsController.setAppearanceLightNavigationBars(true);
            }

            View contentView = findViewById(android.R.id.content);
            if (contentView != null) {
                contentView.setPadding(0, 0, 0, 0);
                ViewCompat.setOnApplyWindowInsetsListener(contentView, null);
            }

            // Apply system bar + IME insets in ONE place only (on decorView)
            // and zero out the insets passed down to child views/WebView so
            // the keyboard (IME) inset is never applied twice.
            ViewCompat.setOnApplyWindowInsetsListener(decorView, (view, windowInsets) -> {
                Insets systemBars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
                boolean imeVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime());

                int bottomPadding = imeVisible
                    ? Math.max(ime.bottom, systemBars.bottom)
                    : systemBars.bottom;

                view.setPadding(
                    systemBars.left,
                    systemBars.top,
                    systemBars.right,
                    bottomPadding
                );

                return new WindowInsetsCompat.Builder(windowInsets)
                    .setInsets(
                        WindowInsetsCompat.Type.systemBars()
                            | WindowInsetsCompat.Type.displayCutout()
                            | WindowInsetsCompat.Type.ime(),
                        Insets.of(0, 0, 0, 0)
                    )
                    .build();
            });
            ViewCompat.requestApplyInsets(decorView);
        }

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            ViewGroup.LayoutParams params = webView.getLayoutParams();
            if (params != null) {
                params.width = ViewGroup.LayoutParams.MATCH_PARENT;
                params.height = ViewGroup.LayoutParams.MATCH_PARENT;
                webView.setLayoutParams(params);
            }

            WebSettings settings = webView.getSettings();
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(false);
            settings.setTextZoom(100);
        }
    }
}
