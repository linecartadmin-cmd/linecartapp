/**
 * LineCart Biometric Authentication & Session Security Service
 *
 * Android Keystore + BiometricPrompt Integration
 * Uses @capgo/capacitor-native-biometric (v8.9.1)
 *
 * SECURITY RULES:
 * 1. Tokens are saved per-account with `server: linecart-session-${userId}`
 *    using `accessControl: AccessControl.BIOMETRY_ANY` which binds an AES-256 GCM key
 *    in AndroidKeyStore requiring biometric authentication.
 * 2. On Android, session tokens are kept in memory only; NEVER in localStorage or IndexedDB.
 * 3. On devices without strong biometrics, offline unlock is disabled and online login is required.
 * 4. Passwords and password hashes are NEVER cached or stored locally.
 * 5. A non-secret account list (ID, name, mobile, role) is stored locally so users can pick
 *    which account to unlock, but unlock is only permitted if that specific account
 *    has actually saved protected credentials.
 */

import { Capacitor } from '@capacitor/core';
import { NativeBiometric, AccessControl } from '@capgo/capacitor-native-biometric';
import { saveUserProfile, getUserProfile, hasUnsyncedMutations } from './offlineDb';

export const SAVED_ACCOUNTS_KEY = 'LineCart_saved_accounts';
export const ACTIVE_USER_KEY = 'LineCartPref_active_user_meta';

export const getBiometricServerKey = (userId) => `linecart-session-${userId}`;

// In-memory token storage (Android native security requirement)
let inMemorySessionToken = null;

export function setMemorySessionToken(token) {
  inMemorySessionToken = token || null;
}

export function getMemorySessionToken() {
  if (inMemorySessionToken) return inMemorySessionToken;
  // Browser fallback only (web platform)
  if (!Capacitor.isNativePlatform() && typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem('LineCartPref_token');
  }
  return null;
}

export function clearMemorySessionToken() {
  inMemorySessionToken = null;
}

/**
 * Get the list of non-secret saved accounts from local storage
 */
export function getSavedAccounts() {
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Save non-secret account profile (name, phone, role)
 */
export function saveAccountProfile(user) {
  if (!user || !user.id) return;
  const accounts = getSavedAccounts();
  const index = accounts.findIndex((a) => Number(a.id) === Number(user.id));
  const entry = {
    id: Number(user.id),
    name: user.name || `User #${user.id}`,
    phone: user.phone || '',
    role: user.role || 'Field Sales Agent',
    clusterId: user.clusterId ?? user.clusterid ?? 1
  };
  if (index >= 0) {
    accounts[index] = entry;
  } else {
    accounts.push(entry);
  }
  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {}
}

/**
 * Remove a saved account and its Keystore credentials
 */
export async function removeSavedAccount(userId) {
  const accounts = getSavedAccounts().filter((a) => Number(a.id) !== Number(userId));
  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {}
  if (Capacitor.isNativePlatform()) {
    try {
      await NativeBiometric.deleteCredentials({ server: getBiometricServerKey(userId) });
    } catch {}
  }
}

/**
 * Verify whether protected credentials actually exist in NativeBiometric Keystore for a specific user
 */
export async function hasBiometricCredential(userId) {
  if (!userId || !Capacitor.isNativePlatform()) return false;
  try {
    const serverKey = getBiometricServerKey(userId);
    const res = await NativeBiometric.isCredentialsSaved({ server: serverKey });
    return Boolean(res && res.isSaved);
  } catch {
    return false;
  }
}

/**
 * Check if the current device supports hardware-backed Class 3 (Strong) biometrics
 */
export async function checkBiometricHardware() {
  if (!Capacitor.isNativePlatform()) {
    return {
      isNative: false,
      isAvailable: false,
      strongBiometryIsAvailable: false,
      reason: 'Web browser environment (biometric Keystore not applicable)'
    };
  }

  try {
    // Explicitly check without fallback to verify strong biometrics (fingerprint/strong face)
    const result = await NativeBiometric.isAvailable({ useFallback: false });
    return {
      isNative: true,
      isAvailable: Boolean(result.isAvailable),
      strongBiometryIsAvailable: Boolean(result.strongBiometryIsAvailable),
      biometryType: result.biometryType,
      deviceIsSecure: Boolean(result.deviceIsSecure),
      errorCode: result.errorCode || null
    };
  } catch (err) {
    return {
      isNative: true,
      isAvailable: false,
      strongBiometryIsAvailable: false,
      error: err.message
    };
  }
}

/**
 * Register active session for offline biometric unlock
 * Called immediately after a successful live online login.
 */
export async function registerBiometricSession(user, sessionToken) {
  if (!user || !user.id || !sessionToken) return { success: false, reason: 'Missing credentials' };

  // 1. Always keep token in memory
  setMemorySessionToken(sessionToken);

  // 2. Cache user profile metadata in IndexedDB (scoped by userId)
  await saveUserProfile(user);

  // 3. Save non-secret profile in local account list
  saveAccountProfile(user);

  // 4. Store active public user metadata (NO token or password)
  const meta = {
    userId: Number(user.id),
    name: user.name,
    phone: user.phone,
    role: user.role,
    clusterId: user.clusterId ?? user.clusterid ?? 1
  };
  try {
    localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(meta));
  } catch {}

  // 5. On Android native, bind the token to Android KeyStore via Biometric AccessControl under per-account server key
  if (Capacitor.isNativePlatform()) {
    const hardware = await checkBiometricHardware();
    if (!hardware.strongBiometryIsAvailable) {
      console.warn('[BiometricAuth] Device lacks enrolled strong biometrics. Offline unlock disabled.');
      return {
        success: false,
        offlineCapable: false,
        reason: 'Device has no enrolled strong biometrics (fingerprint required for offline Keystore protection).'
      };
    }

    try {
      const serverKey = getBiometricServerKey(user.id);
      await NativeBiometric.setCredentials({
        server: serverKey,
        username: String(user.id),
        password: sessionToken,
        accessControl: AccessControl.BIOMETRY_ANY,
        title: 'Protect LineCart Session',
        negativeButtonText: 'Cancel'
      });
      return { success: true, offlineCapable: true };
    } catch (err) {
      console.error('[BiometricAuth] Failed to set hardware-protected credentials:', err);
      return { success: false, offlineCapable: false, error: err.message };
    }
  }

  return { success: true, offlineCapable: false };
}

/**
 * Attempt to unlock the offline session using hardware biometrics for a selected account
 */
export async function unlockOfflineSession(targetUserId = null) {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Offline biometric unlock is only available on Android native app.');
  }

  // 1. Identify target user
  let userId = targetUserId;
  let meta = null;
  if (!userId) {
    try {
      const raw = localStorage.getItem(ACTIVE_USER_KEY);
      if (raw) meta = JSON.parse(raw);
      if (meta && meta.userId) userId = meta.userId;
    } catch {}
  }

  if (!userId) {
    const accounts = getSavedAccounts();
    if (accounts.length > 0) {
      userId = accounts[0].id;
      meta = accounts[0];
    }
  }

  if (!userId) {
    throw new Error('No previously authenticated user found. Live online login required.');
  }

  // 2. Verify hardware availability
  const hardware = await checkBiometricHardware();
  if (!hardware.strongBiometryIsAvailable) {
    throw new Error('Offline biometric unlock requires enrolled strong biometrics (fingerprint/face). Please sign in online.');
  }

  // 3. Verify that credentials actually exist in Keystore before triggering prompt
  const serverKey = getBiometricServerKey(userId);
  const exists = await hasBiometricCredential(userId);
  if (!exists) {
    throw new Error('No protected credentials found for this account. Please sign in with your mobile number and password first.');
  }

  const savedAccounts = getSavedAccounts();
  const accountMeta = meta || savedAccounts.find((a) => Number(a.id) === Number(userId)) || { name: `User #${userId}` };

  // 4. Trigger native BiometricPrompt cryptographically bound to Keystore decryption
  let creds;
  try {
    creds = await NativeBiometric.getSecureCredentials({
      server: serverKey,
      title: 'Unlock LineCart',
      subtitle: `Verify biometric identity for ${accountMeta.name}`,
      description: 'Authenticate to access offline orders and customer shops.',
      negativeButtonText: 'Cancel'
    });
  } catch (err) {
    console.warn('[BiometricAuth] Biometric unlock cancelled or failed:', err);
    throw new Error(err.message || 'Biometric authentication failed or cancelled.');
  }

  if (!creds || !creds.password) {
    throw new Error('No valid cryptographic credential returned from Keystore.');
  }

  // 5. Restore session token into memory
  setMemorySessionToken(creds.password);

  // 6. Load user profile from IndexedDB
  const profile = await getUserProfile(userId);
  const userObj = profile || {
    id: userId,
    name: accountMeta.name,
    phone: accountMeta.phone,
    role: accountMeta.role,
    clusterid: accountMeta.clusterId || 1
  };

  // Update active user meta
  try {
    localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify({
      userId: Number(userObj.id),
      name: userObj.name,
      phone: userObj.phone,
      role: userObj.role,
      clusterId: userObj.clusterId ?? userObj.clusterid ?? 1
    }));
  } catch {}

  return {
    user: userObj,
    sessionToken: creds.password
  };
}

/**
 * Cleanly lock the application (clear in-memory token)
 */
export function lockAppSession() {
  clearMemorySessionToken();
}

/**
 * Complete sign-out (clear memory and remove Keystore credentials)
 */
export async function signOutAppSession(userId = null) {
  clearMemorySessionToken();
  if (Capacitor.isNativePlatform()) {
    try {
      if (userId) {
        await NativeBiometric.deleteCredentials({ server: getBiometricServerKey(userId) });
      }
    } catch {}
  }
}

/**
 * Check if another user previously had unsynced changes before switching accounts
 */
export async function checkPreviousUserUnsynced(incomingUserId) {
  try {
    const raw = localStorage.getItem(ACTIVE_USER_KEY);
    if (!raw) return { hasConflict: false };
    const prev = JSON.parse(raw);
    if (prev && prev.userId && Number(prev.userId) !== Number(incomingUserId)) {
      const hasUnsynced = await hasUnsyncedMutations(prev.userId);
      return {
        hasConflict: hasUnsynced,
        previousUserId: prev.userId,
        previousUserName: prev.name
      };
    }
  } catch {}
  return { hasConflict: false };
}
