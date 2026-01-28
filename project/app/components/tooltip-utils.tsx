export const renderTooltipContentChildren = (text?: any) => {
  if (text === undefined || text === null) return null;
  const s = String(text);
  if (/^https?:\/\//i.test(s)) {
    return <a href={s} target="_blank" rel="noreferrer noopener">{s}</a>;
  }
  return s;
};
