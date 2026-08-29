import "server-only";

import { isRelifeLegacyTenant, legacyLedgerTenant } from "@/lib/config/relifeSystem";
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
  const physioTenant = legacyLedgerTenant("Physio");
  const dentalTenant = legacyLedgerTenant("Dental");
  if (scope === "physio") return getPayments(physioTenant.organizationId, physioTenant.clinicId);
  if (scope === "dental") return getPayments(dentalTenant.organizationId, dentalTenant.clinicId);
  const [physioRows, dentalRows] = await Promise.all([
    getPayments(physioTenant.organizationId, physioTenant.clinicId),
    getPayments(dentalTenant.organizationId, dentalTenant.clinicId),
  ]);
  return [...physioRows, ...dentalRows];
}

async function relifeExpenses(scope: Scope) {
  const physioTenant = legacyLedgerTenant("Physio");
  const dentalTenant = legacyLedgerTenant("Dental");
  if (scope === "physio") return getExpenses(physioTenant.organizationId, physioTenant.clinicId);
  if (scope === "dental") return getExpenses(dentalTenant.organizationId, dentalTenant.clinicId);
  const [physioRows, dentalRows] = await Promise.all([
    getExpenses(physioTenant.organizationId, physioTenant.clinicId),
    getExpenses(dentalTenant.organizationId, dentalTenant.clinicId),
  ]);
  return [...physioRows, ...dentalRows];
}

async function relifeCashMovements(scope: Scope) {
  const physioTenant = legacyLedgerTenant("Physio");
  const dentalTenant = legacyLedgerTenant("Dental");
  if (scope === "physio") return getCashMovements(physioTenant.organizationId, physioTenant.clinicId);
  if (scope === "dental") return getCashMovements(dentalTenant.organizationId, dentalTenant.clinicId);
  const [physioRows, dentalRows] = await Promise.all([
    getCashMovements(physioTenant.organizationId, physioTenant.clinicId),
    getCashMovements(dentalTenant.organizationId, dentalTenant.clinicId),
  ]);
  return [...physioRows, ...dentalRows];
}

async function relifeSalaryPayments(scope: Scope) {
  const physioTenant = legacyLedgerTenant("Physio");
  const dentalTenant = legacyLedgerTenant("Dental");
  if (scope === "physio") return getSalaryPayments(physioTenant.organizationId, physioTenant.clinicId);
  if (scope === "dental") return getSalaryPayments(dentalTenant.organizationId, dentalTenant.clinicId);
  const [physioRows, dentalRows] = await Promise.all([
    getSalaryPayments(physioTenant.organizationId, physioTenant.clinicId),
    getSalaryPayments(dentalTenant.organizationId, dentalTenant.clinicId),
  ]);
  return [...physioRows, ...dentalRows];
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
