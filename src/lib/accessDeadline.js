/** Access may outlast payment; this deadline never controls credit expiry. */
export function accessDeadline(entitlement) {
  const access = Date.parse(entitlement?.accessUntil || '');
  if (Number.isFinite(access)) return access;
  const paid = Date.parse(entitlement?.periodEnd || '');
  if (Number.isFinite(paid)) return paid;
  // Null-ended manual grants are intentional; malformed nonempty dates are not.
  return entitlement?.accessUntil || entitlement?.periodEnd ? 0 : NaN;
}
