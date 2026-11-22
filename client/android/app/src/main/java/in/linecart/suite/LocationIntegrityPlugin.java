package in.linecart.suite;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.core.location.LocationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Fresh location fix for shop-visit verification, plus Android's own mock-location flag.
 *
 * Uses Google Play services' fused location provider: the same engine @capacitor/geolocation uses for
 * "Fetch Location" in customer creation. It combines GPS, Wi-Fi and mobile-network positioning, so it gets a
 * fix indoors where a GPS-satellite-only request times out. Visit-specific rules on top:
 *  - Fresh only: maxUpdateAge 0, and any fix older than the request is ignored. Never a cached position.
 *  - Precise only: ACCESS_FINE_LOCATION is required; approximate-only permission is reported as PRECISE_REQUIRED.
 *  - Keeps reading high-accuracy updates until one meets desiredAccuracyM (the server's ±metres limit) or
 *    the timeout passes; then returns the best fix seen (meetsAccuracy=false) so the server decides.
 *  - isMock / anyMock: Location.isMock() (Android 12+) or isFromMockProvider(); anyMock is true if ANY fix in
 *    this request came from a mock provider.
 *  - Without Google Play services it falls back to the platform GPS and network providers with the same rules.
 *
 * JS: registerPlugin('LocationIntegrity').getFreshLocation({ timeoutMs, desiredAccuracyM })
 *  -> { latitude, longitude, accuracy, time, provider, source, isMock, anyMock, meetsAccuracy, waitedMs }
 *  rejects with code PERMISSION_DENIED | PRECISE_REQUIRED | SERVICES_DISABLED | TIMEOUT | UNAVAILABLE
 */
@CapacitorPlugin(name = "LocationIntegrity")
public class LocationIntegrityPlugin extends Plugin {

    static final String CODE_PERMISSION_DENIED = "PERMISSION_DENIED";
    static final String CODE_PRECISE_REQUIRED = "PRECISE_REQUIRED";
    static final String CODE_SERVICES_DISABLED = "SERVICES_DISABLED";
    static final String CODE_TIMEOUT = "TIMEOUT";
    static final String CODE_UNAVAILABLE = "UNAVAILABLE";

    @PluginMethod
    public void getFreshLocation(final PluginCall call) {
        final Context context = getContext();
        final boolean fine = granted(context, Manifest.permission.ACCESS_FINE_LOCATION);
        final boolean coarse = granted(context, Manifest.permission.ACCESS_COARSE_LOCATION);
        if (!fine) {
            if (coarse) {
                call.reject("Precise location is off for this app (only approximate location is allowed)", CODE_PRECISE_REQUIRED);
            } else {
                call.reject("Location permission not granted", CODE_PERMISSION_DENIED);
            }
            return;
        }
        final LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) {
            call.reject("Location unavailable on this device", CODE_UNAVAILABLE);
            return;
        }
        if (!LocationManagerCompat.isLocationEnabled(lm)) {
            call.reject("Location services are disabled", CODE_SERVICES_DISABLED);
            return;
        }
        final int timeoutMs = Math.max(5000, Math.min(60000, call.getInt("timeoutMs", 20000)));
        final double desired = call.getDouble("desiredAccuracyM", 30.0);
        final float desiredAccuracyM = (float) Math.max(1.0, Math.min(1000.0, desired));
        new FreshFix(call, context, lm, timeoutMs, desiredAccuracyM).start();
    }

    private static boolean granted(Context context, String permission) {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED;
    }

    /** One fresh-fix request. All callbacks run on the main looper. */
    private static final class FreshFix {
        private final PluginCall call;
        private final Context context;
        private final LocationManager lm;
        private final int timeoutMs;
        private final float desiredAccuracyM;
        private final Handler handler = new Handler(Looper.getMainLooper());
        private final AtomicBoolean done = new AtomicBoolean(false);
        private final long startElapsedNs = SystemClock.elapsedRealtimeNanos();
        private final long startMs = SystemClock.elapsedRealtime();

        private Location best = null;
        private String bestSource = null;
        private boolean anyMock = false;

        private FusedLocationProviderClient fusedClient = null;
        private LocationCallback fusedCallback = null;
        private LocationListener platformListener = null;

        FreshFix(PluginCall call, Context context, LocationManager lm, int timeoutMs, float desiredAccuracyM) {
            this.call = call;
            this.context = context;
            this.lm = lm;
            this.timeoutMs = timeoutMs;
            this.desiredAccuracyM = desiredAccuracyM;
        }

        void start() {
            handler.postDelayed(this::onTimeout, timeoutMs);
            boolean playServices = false;
            try {
                playServices = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS;
            } catch (RuntimeException ignored) {
                // No Google Play services library/runtime: use the platform providers
            }
            if (playServices) {
                startFused();
            } else {
                startPlatform();
            }
        }

        private void startFused() {
            try {
                fusedClient = LocationServices.getFusedLocationProviderClient(context);
                LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000)
                        .setMinUpdateIntervalMillis(500)
                        .setMaxUpdateAgeMillis(0)
                        .setDurationMillis(timeoutMs + 1000L)
                        .build();
                fusedCallback = new LocationCallback() {
                    @Override
                    public void onLocationResult(@NonNull LocationResult result) {
                        for (Location l : result.getLocations()) offer(l, "fused");
                    }
                };
                fusedClient.requestLocationUpdates(request, fusedCallback, Looper.getMainLooper())
                        .addOnFailureListener(e -> {
                            // Play services could not serve the request: continue with the platform providers
                            if (done.get()) return;
                            stopFused();
                            startPlatform();
                        });
            } catch (SecurityException e) {
                fail("Location permission not granted", CODE_PERMISSION_DENIED);
            }
        }

        private void startPlatform() {
            platformListener = new LocationListener() {
                @Override
                public void onLocationChanged(@NonNull Location location) {
                    offer(location, "platform");
                }

                // Required on Android 7 to 10, where these are not default methods
                @Override
                public void onStatusChanged(String p, int status, Bundle extras) {}

                @Override
                public void onProviderEnabled(@NonNull String p) {}

                @Override
                public void onProviderDisabled(@NonNull String p) {}
            };
            boolean any = false;
            for (String provider : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }) {
                try {
                    if (lm.isProviderEnabled(provider)) {
                        lm.requestLocationUpdates(provider, 500L, 0f, platformListener, Looper.getMainLooper());
                        any = true;
                    }
                } catch (SecurityException e) {
                    fail("Location permission not granted", CODE_PERMISSION_DENIED);
                    return;
                } catch (IllegalArgumentException ignored) {
                    // Provider not present on this device
                }
            }
            if (!any) fail("Location services are disabled", CODE_SERVICES_DISABLED);
        }

        private void offer(Location l, String source) {
            if (l == null || done.get()) return;
            // Fresh only: ignore anything produced before this request started
            if (l.getElapsedRealtimeNanos() < startElapsedNs) return;
            if (isMock(l)) anyMock = true;
            // Best = most accurate so far; on a tie the newer fix wins
            if (best == null || (l.hasAccuracy() && (!best.hasAccuracy() || l.getAccuracy() <= best.getAccuracy()))) {
                best = l;
                bestSource = source;
            }
            if (l.hasAccuracy() && l.getAccuracy() <= desiredAccuracyM) finish(l, source);
        }

        private void onTimeout() {
            if (done.get()) return;
            if (best != null) {
                finish(best, bestSource);
            } else {
                fail("No GPS fix within " + (timeoutMs / 1000) + " s", CODE_TIMEOUT);
            }
        }

        private void finish(Location l, String source) {
            if (done.getAndSet(true)) return;
            stopAll();
            JSObject out = new JSObject();
            out.put("latitude", l.getLatitude());
            out.put("longitude", l.getLongitude());
            out.put("accuracy", l.hasAccuracy() ? l.getAccuracy() : null);
            out.put("time", l.getTime());
            out.put("provider", l.getProvider());
            out.put("source", source);
            out.put("isMock", isMock(l));
            out.put("anyMock", anyMock);
            out.put("meetsAccuracy", l.hasAccuracy() && l.getAccuracy() <= desiredAccuracyM);
            out.put("desiredAccuracyM", desiredAccuracyM);
            out.put("waitedMs", SystemClock.elapsedRealtime() - startMs);
            call.resolve(out);
        }

        private void fail(String message, String code) {
            if (done.getAndSet(true)) return;
            stopAll();
            call.reject(message, code);
        }

        private void stopAll() {
            handler.removeCallbacksAndMessages(null);
            stopFused();
            if (platformListener != null) {
                try {
                    lm.removeUpdates(platformListener);
                } catch (RuntimeException ignored) {
                }
                platformListener = null;
            }
        }

        private void stopFused() {
            if (fusedClient != null && fusedCallback != null) {
                fusedClient.removeLocationUpdates(fusedCallback);
            }
            fusedCallback = null;
        }

        private static boolean isMock(Location l) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return l.isMock();
            return l.isFromMockProvider();
        }
    }
}
