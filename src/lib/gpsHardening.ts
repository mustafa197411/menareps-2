import { saveAuditLogRecord } from "./firestoreService";
import { AuditLog, Role } from "../types";

export interface GPSRecord {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: string;
  source: "device" | "simulation_demo";
  errorDetails?: string;
  spoofCheckStatus: "Passed" | "Suspicious" | "Bypassed (Demo)";
  quality?: "GOOD" | "LOW_ACCURACY_WARNING";
}

export interface AcquireGpsOptions {
  accuracyMode?: "HARD_REJECT" | "WARNING_ONLY";
}

export function isGPSDemoMode(): boolean {
  if (!import.meta.env.DEV) return false;
  const stored = localStorage.getItem("gps_demo_mode");
  if (stored !== null) {
    return stored === "true";
  }
  // Default to false in all environments (strict native GPS by default)
  return false;
}

export function setGPSDemoMode(enabled: boolean): void {
  if (!import.meta.env.DEV) {
    localStorage.removeItem("gps_demo_mode");
    return;
  }
  localStorage.setItem("gps_demo_mode", enabled ? "true" : "false");
}

/**
 * Robust native GPS retriever.
 * Requests user permission clearly, handles error states (denied, unavailable, timeout),
 * and handles fallback if explicitly marked as demo mode.
 * Writes an audit log record for both success and failure states.
 */
export async function acquireHardenedGPS(
  currentUser: { id: string; name: string; role?: Role },
  contextName: string,
  options?: AcquireGpsOptions
): Promise<GPSRecord> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      const errorMsg = "Geolocation is not supported by this browser/device.";
      handleGpsFailure(currentUser, contextName, errorMsg, resolve, reject);
      return;
    }

    const posOptions: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 0
    };

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const accuracy = position.coords.accuracy;
        const accuracyMode = options?.accuracyMode || "HARD_REJECT";
        
        // Check accuracy larger than 100 meters
        if (accuracy > 100 && accuracyMode === "HARD_REJECT") {
          const errorMsg = `GPS precision error: Accuracy is too low (${accuracy.toFixed(1)}m), which exceeds the 100-meter enterprise limit. Please move to an outdoor or open area to establish a better satellite connection.`;
          handleGpsFailure(currentUser, contextName, errorMsg, resolve, reject);
          return;
        }

        // Spoof check and mock location check
        const isMocked = (position as any).mocked || 
                         (position.coords as any).isMocked || 
                         (position.coords as any).mocked || 
                         false;

        if (isMocked) {
          const errorMsg = "Mock Location Detected: Device mock locations are active. Standard MENAREPS compliance rules strictly block mock geolocation usage.";
          handleGpsFailure(currentUser, contextName, errorMsg, resolve, reject);
          return;
        }

        const isLowAccuracy = accuracy > 100;

        const record: GPSRecord = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: new Date().toISOString(),
          source: "device",
          spoofCheckStatus: "Passed",
          quality: isLowAccuracy ? "LOW_ACCURACY_WARNING" : "GOOD"
        };

        // Write audit log for success
        const auditLog: AuditLog = {
          id: `AL-GPS-${Math.floor(100000 + Math.random() * 900000)}`,
          userId: currentUser.id,
          userName: currentUser.name,
          userRole: currentUser.role,
          action: isLowAccuracy ? "GPS Verification Success (Low Accuracy Warning)" : "GPS Verification Success",
          entityType: "GPS",
          entityName: contextName,
          details: `GPS lock acquired via native device telemetry for "${contextName}". Coords: (${record.latitude.toFixed(5)}, ${record.longitude.toFixed(5)}), Accuracy: ${record.accuracy.toFixed(1)}m. Spoof Check: Passed. Quality: ${record.quality}.`,
          timestamp: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC"
        };
        
        try {
          await saveAuditLogRecord(auditLog);
        } catch (e) {
          console.warn("Could not save GPS success audit log:", e);
        }

        resolve(record);
      },
      async (error) => {
        let errorDetails = "Unknown geolocation error.";
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorDetails = "Permission denied by operator/user.";
            break;
          case error.POSITION_UNAVAILABLE:
            errorDetails = "Device satellite or network location unavailable.";
            break;
          case error.TIMEOUT:
            errorDetails = "Location acquisition request timed out (8s limit exceeded).";
            break;
        }
        
        handleGpsFailure(currentUser, contextName, errorDetails, resolve, reject);
      },
      posOptions
    );
  });
}

async function handleGpsFailure(
  currentUser: { id: string; name: string; role?: Role },
  contextName: string,
  errorDetails: string,
  resolve: (value: GPSRecord) => void,
  reject: (reason: any) => void
) {
  const isDemo = isGPSDemoMode();
  
  // Write audit log for failure
  const auditLog: AuditLog = {
    id: `AL-GPS-${Math.floor(100000 + Math.random() * 900000)}`,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: "GPS Verification Failure",
    entityType: "GPS",
    entityName: contextName,
    details: `Failed to acquire native GPS for "${contextName}". Error: ${errorDetails}. Fallback allowed: ${isDemo ? "Yes (Demo Mode Active)" : "No"}.`,
    timestamp: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC"
  };

  try {
    await saveAuditLogRecord(auditLog);
  } catch (e) {
    console.warn("Could not save GPS failure audit log:", e);
  }

  if (isDemo) {
    // Return high accuracy Tripoli/Amman default coords
    const record: GPSRecord = {
      latitude: 32.8872,
      longitude: 13.1913,
      accuracy: 15.0,
      timestamp: new Date().toISOString(),
      source: "simulation_demo",
      spoofCheckStatus: "Bypassed (Demo)",
      errorDetails: `Fitted fallback coordinates because native fetch failed: ${errorDetails}`
    };
    resolve(record);
  } else {
    reject(new Error(errorDetails));
  }
}
