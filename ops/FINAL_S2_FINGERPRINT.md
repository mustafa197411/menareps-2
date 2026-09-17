# FINAL-S2 Samples fingerprint

Run from the repository root:

```bash
LC_ALL=C sort -c ops/final-s2-samples.manifest && while IFS= read -r path; do sha256sum "$path"; done < ops/final-s2-samples.manifest | sha256sum | awk '{print $1}'
```

The manifest deliberately does not include itself or this documentation, avoiding a circular fingerprint.
The historical pre-repair fingerprint remains evidence only because its original manifest was not persisted.
