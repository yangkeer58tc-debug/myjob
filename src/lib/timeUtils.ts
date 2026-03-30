export const formatRelativeTime = (dateStr: string, lang: 'es' | 'en' = 'es') => {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return lang === 'es' ? 'Justo ahora' : 'Just now';
  if (diffMin < 60) return lang === 'es' ? `hace ${diffMin} min` : `${diffMin} min ago`;
  if (diffHours < 24) return lang === 'es' ? `hace ${diffHours}h` : `${diffHours}h ago`;
  return lang === 'es' ? `hace ${diffDays}d` : `${diffDays}d ago`;
};
