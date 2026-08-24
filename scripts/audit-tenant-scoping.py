#!/usr/bin/env python3
"""
T2-02 audit: Find API routes that need tenant context updates.
Identifies routes using requireCurrentAccessContext but not requireCurrentTenantAccessContext.
"""

import os
import re
from pathlib import Path

def scan_api_routes():
    api_dir = Path("app/api")
    critical_patterns = ["patients", "appointments", "clinical", "finance", "chamber", "inventory"]

    results = {
        "tenant_aware": [],
        "tenant_unaware": [],
    }

    for route_file in api_dir.rglob("route.ts"):
        # Skip non-critical routes
        is_critical = any(pattern in str(route_file) for pattern in critical_patterns)
        if not is_critical:
            continue

        content = route_file.read_text()

        # Check for imports and usage
        has_tenant_context = "requireCurrentTenantAccessContext" in content or "getCurrentTenantAccessContext" in content
        has_access_context = "requireCurrentAccessContext" in content or "getCurrentAccessContext" in content

        relative_path = route_file.relative_to(".")

        if has_tenant_context:
            results["tenant_aware"].append(str(relative_path))
        elif has_access_context:
            results["tenant_unaware"].append(str(relative_path))

    return results

if __name__ == "__main__":
    results = scan_api_routes()

    print("=== T2-02 Tenant Scoping Audit ===\n")

    print(f"✅ Tenant-aware routes ({len(results['tenant_aware'])}):")
    for route in sorted(results["tenant_aware"]):
        print(f"  {route}")

    print(f"\n⚠️  Tenant-unaware routes ({len(results['tenant_unaware'])}):")
    for route in sorted(results["tenant_unaware"]):
        print(f"  {route}")

    print(f"\nTotal critical routes: {len(results['tenant_aware']) + len(results['tenant_unaware'])}")
    print(f"Remaining work: {len(results['tenant_unaware'])} routes need tenant context update")
