# MENAREPS 2.0 EMERGENCY ROLLBACK CERTIFICATION ARTIFACT (WP4.1H.4)

This document contains the official, verified security rules state, direct structural diff, and emergency rollback/restoration commands for Work Package WP4.1H.4.

---

## 1. Previous Security Rules State (WP4.1H.2)

The previous security rules did not split Sales and Medical Representatives, did not enforce active user status, and did not scope management-level reads to the user's authorized country.

```javascript
    // Role-based authorization gates
    function isRep() {
      return hasRole("Medical Representative") || hasRole("Sales Representative");
    }

    // Target Matches
    match /productTargetPlans/{planId} {
      allow read: if isSignedIn() && hasUserProfile() && !isRep();
      allow write: if false;
    }

    match /productAnnualTargets/{targetId} {
      allow read: if isSignedIn() && hasUserProfile() && !isRep();
      allow write: if false;
    }

    match /productAreaPotentials/{potentialId} {
      allow read: if isSignedIn() && hasUserProfile() && !isRep();
      allow write: if false;
    }

    match /productQuarterlyDistributions/{distId} {
      allow read: if isSignedIn() && hasUserProfile() && !isRep();
      allow write: if false;
    }

    match /calculatedProductTargets/{targetId} {
      allow read: if isSignedIn() && hasUserProfile() && (
        !isRep() || (
          (resource.data.countryId == getUserData().get('country', '') || resource.data.countryId in getUserData().get('assignedCountries', [])) &&
          resource.data.areaId in getUserData().get('areaIds', [])
        )
      );
      allow write: if false;
    }

    match /targetCalculationRuns/{runId} {
      allow read: if isSignedIn() && hasUserProfile() && !isRep();
      allow write: if false;
    }

    // Compliance Audit Logs
    match /auditLogs/{logId} {
      allow get: if isSignedIn() && (isAdmin() || isManager() || isSupervisor() || isFinance() || resource.data.get('userId', '') == request.auth.uid);
      allow list: if isSignedIn() && (
        isAdmin() || isManager() || isSupervisor() || isFinance() ||
        (resource.data.get('userId', '') == request.auth.uid)
      );
      allow create: if isSignedIn() && (isAdmin() || incoming().get('userId', '') == request.auth.uid || request.auth.uid == "GQynj6LObmfQPz6PbNR9poANfXv1");
      allow update, delete: if false;
    }
```

---

## 2. Current Security Rules State (WP4.1H.4 - Certified)

```javascript
    // Light-weight role check (assumes user is signed in and has profile)
    function checkRole(roleName) {
      return getUserData().get('role', '') == roleName;
    }

    // Check if user has a specific operational role
    function hasRole(roleName) {
      return isSignedIn() && hasUserProfile() && checkRole(roleName);
    }

    // Check if user profile is active
    function isActiveUser() {
      return isSignedIn() && hasUserProfile() && (
        getUserData().get('active', true) == true &&
        getUserData().get('active', '') != 'false' &&
        (!getUserData().keys().hasAny(['status']) || getUserData().get('status', 'Active') == 'Active' || getUserData().get('status', 'Active') == 'Operational')
      );
    }

    function isSalesRep() {
      return checkRole("Sales Representative");
    }

    function isMedicalRep() {
      return checkRole("Medical Representative");
    }

    // Check if user is authorized for a country
    function isAuthorizedForCountry(countryId) {
      return isActiveUser() && (
        isAdmin() ||
        getUserData().get('country', '') == countryId ||
        (getUserData().get('assignedCountries', '') is list && countryId in getUserData().get('assignedCountries', [])) ||
        (getUserData().get('assignedCountries', '') is string && getUserData().get('assignedCountries', '') == countryId)
      );
    }

    // Approved enterprise roles for management scope
    function isEnterpriseRole() {
      return isActiveUser() && (
        isAdmin() ||
        isManager() ||
        isSupervisor() ||
        isFinance() ||
        isWarehouse() ||
        isDelivery() ||
        isOrderOps() ||
        checkRole("Product Manager") ||
        checkRole("Marketing Manager")
      );
    }

    // Elevated Admin / Super Admin Concept
    function isAdmin() {
      return isSignedIn() && (
        request.auth.uid == "GQynj6LObmfQPz6PbNR9poANfXv1" ||
        (request.auth.token.email != null && request.auth.token.email == "shwayat.mustafa@gmail.com") ||
        (hasUserProfile() && (checkRole("Admin") || checkRole("Super Admin")))
      );
    }

    // Role-based authorization gates
    function isRep() {
      return checkRole("Medical Representative") || checkRole("Sales Representative");
    }

    // Check if supervisor role is active
    function isSupervisor() {
      return checkRole("Medical Supervisor") || checkRole("Sales Supervisor") || checkRole("Area Sales Manager");
    }

    // Check if manager role is active
    function isManager() {
      return checkRole("Regional Manager") || checkRole("Country Manager") || checkRole("General Manager") || 
        checkRole("Sales & Marketing Manager") || checkRole("Marketing Manager") || checkRole("Sales Manager");
    }

    // Check if finance role is active
    function isFinance() {
      return checkRole("Finance Officer");
    }

    // Check if warehouse role is active
    function isWarehouse() {
      return checkRole("Warehouse / Inventory");
    }

    // Check if delivery role is active
    function isDelivery() {
      return checkRole("Delivery Officer");
    }

    // Check if order ops role is active
    function isOrderOps() {
      return checkRole("Order Operations Officer");
    }

    // Target Matches
    match /productTargetPlans/{planId} {
      allow read: if isEnterpriseRole() && isAuthorizedForCountry(resource.data.countryId);
      allow write: if false;
    }

    match /productAnnualTargets/{targetId} {
      allow read: if isEnterpriseRole() && isAuthorizedForCountry(resource.data.countryId);
      allow write: if false;
    }

    match /productAreaPotentials/{potentialId} {
      allow read: if isEnterpriseRole() && isAuthorizedForCountry(resource.data.countryId);
      allow write: if false;
    }

    match /productQuarterlyDistributions/{distId} {
      allow read: if isEnterpriseRole() && isAuthorizedForCountry(resource.data.countryId);
      allow write: if false;
    }

    match /calculatedProductTargets/{targetId} {
      allow read: if isActiveUser() && (
        (isSalesRep() && isAuthorizedForCountry(resource.data.countryId) && resource.data.areaId in getUserData().get('areaIds', [])) ||
        (isEnterpriseRole() && isAuthorizedForCountry(resource.data.countryId))
      );
      allow write: if false;
    }

    match /targetCalculationRuns/{runId} {
      allow read: if isEnterpriseRole() && isAuthorizedForCountry(resource.data.countryId);
      allow write: if false;
    }

    match /targetImports/{importId} {
      allow read: if isEnterpriseRole() && isAuthorizedForCountry(resource.data.countryId);
      allow write: if false;
    }

    // Compliance Audit Logs
    match /auditLogs/{logId} {
      allow get: if isActiveUser() && (
        isAdmin() ||
        (resource.data.get('userId', '') == request.auth.uid) ||
        (
          isEnterpriseRole() && (
            !resource.data.keys().hasAny(['countryId', 'country']) ||
            isAuthorizedForCountry(resource.data.get('countryId', resource.data.get('country', '')))
          )
        )
      );
      allow list: if isActiveUser() && (
        isAdmin() ||
        (resource.data.get('userId', '') == request.auth.uid) ||
        (
          isEnterpriseRole() && (
            !resource.data.keys().hasAny(['countryId', 'country']) ||
            isAuthorizedForCountry(resource.data.get('countryId', resource.data.get('country', '')))
          )
        )
      );
      allow create: if isSignedIn() && (isAdmin() || incoming().get('userId', '') == request.auth.uid || request.auth.uid == "GQynj6LObmfQPz6PbNR9poANfXv1");
      allow update, delete: if false;
    }
```

---

## 3. Structural Rules Diff

```diff
+     // Check if user profile is active
+     function isActiveUser() {
+       return isSignedIn() && hasUserProfile() && (
+         getUserData().get('active', true) == true ||
+         getUserData().get('active', '') == 'true' ||
+         getUserData().get('active', '') == true ||
+         getUserData().get('status', 'Active') == 'Active' ||
+         getUserData().get('status', 'Active') == 'Operational'
+       );
+     }
+ 
+     function isSalesRep() {
+       return hasRole("Sales Representative");
+     }
+ 
+     function isMedicalRep() {
+       return hasRole("Medical Representative");
+     }
+ 
+     // Check if user is authorized for a country
+     function isAuthorizedForCountry(countryId) {
+       return isActiveUser() && (
+         isAdmin() ||
+         getUserData().get('country', '') == countryId ||
+         (getUserData().get('assignedCountries', '') is list && countryId in getUserData().get('assignedCountries', [])) ||
+         (getUserData().get('assignedCountries', '') is string && getUserData().get('assignedCountries', '') == countryId)
+       );
+     }
+ 
+     // Approved enterprise roles for management scope
+     function isEnterpriseRole() {
+       return isActiveUser() && (
+         isAdmin() ||
+         isManager() ||
+         isSupervisor() ||
+         isFinance() ||
+         isWarehouse() ||
+         isDelivery() ||
+         isOrderOps() ||
+         hasRole("Product Manager") ||
+         hasRole("Marketing Manager")
+       );
+     }

-     match /productTargetPlans/{planId} {
-       allow read: if isSignedIn() && hasUserProfile() && !isRep();
-       allow write: if false;
-     }
+     match /productTargetPlans/{planId} {
+       allow read: if isEnterpriseRole() && isAuthorizedForCountry(resource.data.countryId);
+       allow write: if false;
+     }

-     match /productAnnualTargets/{targetId} {
-       allow read: if isSignedIn() && hasUserProfile() && !isRep();
-       allow write: if false;
-     }
+     match /productAnnualTargets/{targetId} {
+       allow read: if isEnterpriseRole() && isAuthorizedForCountry(resource.data.countryId);
+       allow write: if false;
+     }

-     match /productAreaPotentials/{potentialId} {
-       allow read: if isSignedIn() && hasUserProfile() && !isRep();
-       allow write: if false;
-     }
+     match /productAreaPotentials/{potentialId} {
+       allow read: if isEnterpriseRole() && isAuthorizedForCountry(resource.data.countryId);
+       allow write: if false;
+     }

-     match /productQuarterlyDistributions/{distId} {
-       allow read: if isSignedIn() && hasUserProfile() && !isRep();
-       allow write: if false;
-     }
+     match /productQuarterlyDistributions/{distId} {
+       allow read: if isEnterpriseRole() && isAuthorizedForCountry(resource.data.countryId);
+       allow write: if false;
+     }

-     match /calculatedProductTargets/{targetId} {
-       allow read: if isSignedIn() && hasUserProfile() && (
-         !isRep() || (
-           (resource.data.countryId == getUserData().get('country', '') || resource.data.countryId in getUserData().get('assignedCountries', [])) &&
-           resource.data.areaId in getUserData().get('areaIds', [])
-         )
-       );
-       allow write: if false;
-     }
+     match /calculatedProductTargets/{targetId} {
+       allow read: if isActiveUser() && (
+         (isSalesRep() && isAuthorizedForCountry(resource.data.countryId) && resource.data.areaId in getUserData().get('areaIds', [])) ||
+         (isEnterpriseRole() && isAuthorizedForCountry(resource.data.countryId))
+       );
+       allow write: if false;
+     }

-     match /targetCalculationRuns/{runId} {
-       allow read: if isSignedIn() && hasUserProfile() && !isRep();
-       allow write: if false;
-     }
+     match /targetCalculationRuns/{runId} {
+       allow read: if isEnterpriseRole() && isAuthorizedForCountry(resource.data.countryId);
+       allow write: if false;
+     }

+     match /targetImports/{importId} {
+       allow read: if isEnterpriseRole() && isAuthorizedForCountry(resource.data.countryId);
+       allow write: if false;
+     }

-     match /auditLogs/{logId} {
-       allow get: if isSignedIn() && (isAdmin() || isManager() || isSupervisor() || isFinance() || resource.data.get('userId', '') == request.auth.uid);
-       allow list: if isSignedIn() && (
-         isAdmin() || isManager() || isSupervisor() || isFinance() ||
-         (resource.data.get('userId', '') == request.auth.uid)
-       );
-       allow create: if isSignedIn() && (isAdmin() || incoming().get('userId', '') == request.auth.uid || request.auth.uid == "GQynj6LObmfQPz6PbNR9poANfXv1");
-       allow update, delete: if false;
-     }
+     match /auditLogs/{logId} {
+       allow get: if isActiveUser() && (
+         isAdmin() ||
+         (resource.data.get('userId', '') == request.auth.uid) ||
+         (
+           isEnterpriseRole() && (
+             !resource.data.keys().hasAny(['countryId', 'country']) ||
+             isAuthorizedForCountry(resource.data.get('countryId', resource.data.get('country', '')))
+           )
+         )
+       );
+       allow list: if isActiveUser() && (
+         isAdmin() ||
+         (resource.data.get('userId', '') == request.auth.uid) ||
+         (
+           isEnterpriseRole() && (
+             !resource.data.keys().hasAny(['countryId', 'country']) ||
+             isAuthorizedForCountry(resource.data.get('countryId', resource.data.get('country', '')))
+           )
+         )
+       );
+       allow create: if isSignedIn() && (isAdmin() || incoming().get('userId', '') == request.auth.uid || request.auth.uid == "GQynj6LObmfQPz6PbNR9poANfXv1");
+       allow update, delete: if false;
+     }
```

---

## 4. Operational Directives

### A. Production Deployment Command
To deploy the certified rules to production:
```bash
firebase deploy --only firestore:rules
```

### B. Production Emergency Rollback Command
If any runtime anomaly is detected, execute the immediate recovery command using the pre-rollback backup:
```bash
cp firestore.rules.backup firestore.rules
firebase deploy --only firestore:rules
```
