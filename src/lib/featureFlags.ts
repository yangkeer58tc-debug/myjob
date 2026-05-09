const isTruthy = (value: string | undefined): boolean => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

export const isResumeAdminEnabled = (): boolean => {
  return isTruthy(import.meta.env.VITE_ENABLE_RESUME_ADMIN);
};

