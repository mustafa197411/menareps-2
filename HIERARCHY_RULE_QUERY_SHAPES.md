# Canonical hierarchy query-shape certification

The hierarchy edge is `users/{uid}.managerId`, whose value must be the
canonical Firebase Auth UID of the user's direct manager.

## Permitted client query

An authenticated, active actor classified by `isSupervisor()` or
`isManager()` may discover only their direct reports with:

```ts
query(collection(db, "users"), where("managerId", "==", auth.currentUser.uid))
```

Additional filters and ordering are permitted only when Firestore can still
prove that every possible result has `managerId == request.auth.uid` (and any
required composite index exists). Recursive hierarchy resolution must repeat
this exact direct-report query once for each discovered manager UID.

A direct document get is permitted for a hierarchy-capable actor only when the
target document's `managerId` equals the actor's UID. Existing self-profile,
own-manager, and explicit administrator gets remain permitted.

## Denied client queries

- `collection(db, "users")` for a non-administrator.
- `where("managerId", "==", anyUidOtherThanAuthUid)`.
- Any query that omits the effective `managerId == auth.currentUser.uid`
  constraint, including queries filtered only by role, department, geography,
  status, or email (except the pre-existing exact self-email rule).
- Direct-report queries by representatives, inactive users, or unauthenticated
  callers.
- A direct get of a user outside the pre-existing self/own-manager rules or the
  actor's immediate subordinate set.

Firestore rules authorize a query against its potential result set, not by
parsing a required `where` clause. The resource predicate
`resource.data.managerId == request.auth.uid` therefore admits the certified
query while rejecting broader queries that could return any other user. Admin
access remains the explicit exception under the existing `isAdmin()` policy.

## Existing temporary administrator identities

The rules currently implement `isAdmin()` with these hard-coded email claims:

- `shwayat.mustafa@gmail.com`
- `test-admin-99@menareps.com`
- `testadmin01@esnad.local`

This change does not add to or otherwise expand that temporary pattern.
