package in.linecart.suite;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Fresh, single location fix for shop-visit verification, plus Android's own mock-location flag.
 *
 * - Never returns a cached/last-known location: it waits for a new fix from the GPS provider
 *   (network provider only if GPS is switched off).
 * - isMock comes from Location.isMock() (Android 12+) or isFromMockProvider() (older versions).
 * - Foreground only; requires ACCESS_FINE_LOCATION, which the app requests from JavaScript first.
 *
 * JS: registerPlugin('LocationIntegrity').getFreshLocation({ timeoutMs })
 *  -> { latitude, longitude, accuracy, time, isMock, provider }
 */
@CapacitorPlugin(name = "LocationIntegrity")
public class LocationIntegrityPlugin extends Plugin {

    @PluginMethod
    public void getFreshLocation(final PluginCall call) {
        final Context context = getContext();
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Location permission not granted");
            return;
        }
        final LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) {
            call.reject("Location unavailable");
            return;
        }
        final boolean gpsOn = lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        final boolean networkOn = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        if (!gpsOn && !networkOn) {
            call.reject("Location services are disabled");
            return;
        }
        final String provider = gpsOn ? LocationManager.GPS_PROVIDER : LocationManager.NETWORK_PROVIDER;
        final int timeoutMs = Math.max(5000, Math.min(60000, call.getInt("timeoutMs", 20000)));
        final Handler handler = new Handler(Looper.getMainLooper());
        final AtomicBoolean done = new AtomicBoolean(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            final CancellationSignal cancel = new CancellationSignal();
            try {
                lm.getCurrentLocation(provider, cancel, context.getMainExecutor(), location -> {
                    if (done.getAndSet(true)) return;
                    if (location == null) {
                        call.reject("Location unavailable");
                    } else {
                        call.resolve(toJs(location));
                    }
                });
            } catch (SecurityException e) {
                done.set(true);
                call.reject("Location permission not granted");
                return;
            }
            handler.postDelayed(() -> {
                if (!done.getAndSet(true)) {
                    cancel.cancel();
                    call.reject("Timed out waiting for a GPS fix");
                }
            }, timeoutMs);
        } else {
            final LocationListener listener = new LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    if (done.getAndSet(true)) return;
                    lm.removeUpdates(this);
                    call.resolve(toJs(location));
                }

                // Required on Android 7 to 10, where these methods are not default methods
                @Override
                public void onStatusChanged(String p, int status, Bundle extras) {}

                @Override
                public void onProviderEnabled(String p) {}

                @Override
                public void onProviderDisabled(String p) {}
            };
            try {
                lm.requestSingleUpdate(provider, listener, Looper.getMainLooper());
            } catch (SecurityException e) {
                done.set(true);
                call.reject("Location permission not granted");
                return;
            }
            handler.postDelayed(() -> {
                if (!done.getAndSet(true)) {
                    lm.removeUpdates(listener);
                    call.reject("Timed out waiting for a GPS fix");
                }
            }, timeoutMs);
        }
    }

    private JSObject toJs(Location location) {
        JSObject out = new JSObject();
        out.put("latitude", location.getLatitude());
        out.put("longitude", location.getLongitude());
        out.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : null);
        out.put("time", location.getTime());
        out.put("provider", location.getProvider());
        boolean mock;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            mock = location.isMock();
        } else {
            mock = location.isFromMockProvider();
        }
        out.put("isMock", mock);
        return out;
    }
}
