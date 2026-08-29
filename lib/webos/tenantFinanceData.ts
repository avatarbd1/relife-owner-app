import "server-only";

import { isRelifeLegacyTenant } from "@/lib/config/relifeSystem";
import {
  getCashMovements,
  getExpenses,
  getPayments,
  getSalaryPayments,
} from "@/lib/data";
import type { Scope } from "@/lib/types";

export type FinanceTenantContext = {
  organizationId: string;
  clinicId: string;
  organizationSlug: string;
  clinicSlug: string;
};

async function relifePayments(scope: Scope) {
  if (scope === "physio") return getPayments("RELIFE", "RELIFE-PHYSIO");
  if (scope === "dental") return getPayments("RELIFE", "RELIFE-DENTAL");
  const [physio, dental] = await Promise.all([
    getPayments("RELIFE", "RELIFE-PHYSIO"),
    getPayments("RELIFE", "RELIFE-DENTAL"),
  ]);
  return [...physio, ...dental];
}

async function relifeExpenses(scope: Scope) {
  if (scope === "physio") return getExpenses("RELIFE", "RELIFE-PHYSIO");
  if (scope === "dental") return getExpenses("RELIFE", "RELIFE-DENTAL");
  const [physio, dental] = await Promise.all([
    getExpenses("RELIFE", "RELIFE-PHYSIO"),
    getExpenses("RELIFE", "RELIFE-DENTAL"),
  ]);
  return [...physio, ...dental];
}

async function relifeCashMovements(scope: Scope) {
  if (scope === "physio") return getCashMovements("RELIFE", "RELIFE-PHYSIO");
  if (scope === "dental") return getCashMovements("RELIFE", "RELIFE-DENTAL");
  const [physio, dental] = await Promise.all([
    getCashMovements("RELIFE", "RELIFE-PHYSIO"),
    getCashMovements("RELIFE", "RELIFE-DENTAL"),
  ]);
  return [...physio, ...dental];
}

async function relifeSalaryPayments(scope: Scope) {
  if (scope === "physio") return getSalaryPayments("RELIFE", "RELIFE-PHYSIO");
  if (scope === "dental") return getSalaryPayments("RELIFE", "RELIFE-DENTAL");
  const [physio, dental] = await Promise.all([
    getSalaryPayments("RELIFE", "RELIFE-PHYSIO"),
    getSalaryPayments("RELIFE", "RELIFE-DENTAL"),
  ]);
  return [...physio, ...dental];
}

export async function readTenantPayments(tenant: FinanceTenantContext, scope: Scope) {
  return isRelifeLegacyTenant(tenant)
    ? relifePayments(scope)
    : getPayments(tenant.organizationId, tenant.clinicId);
}

export async function readTenantExpenses(tenant: FinanceTenantContext, scope: Scope) {
  return isRelifeLegacyTenant(tenant)
    ? relifeExpenses(scope)
    : getExpenses(tenant.organizationId, tenant.clinicId);
}

export async function readTenantCashMovements(tenant: FinanceTenantContext, scope: Scope) {
  return isRelifeLegacyTenant(tenant)
    ? relifeCashMovements(scope)
    : getCashMovements(tenant.organizationId, tenant.clinicId);
}

export async function readTenantSalaryPayments(tenant: FinanceTenantContext, scope: Scope) {
  return isRelifeLegacyTenant(tenant)
    ? relifeSalaryPayments(scope)
    : getSalaryPayments(tenant.organizationId, tenant.clinicId);
}
