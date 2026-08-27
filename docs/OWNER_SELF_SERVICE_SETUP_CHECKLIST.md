# Owner Self-Service Verification Checklist

Before merge:

- lint passes
- full Node test suite passes
- Next.js production build passes
- owner self-service boundary tests pass
- no production migration is added
- no browser path receives service-role credentials
- owner feature selection cannot mutate plan entitlements
- readiness remains fail-closed
