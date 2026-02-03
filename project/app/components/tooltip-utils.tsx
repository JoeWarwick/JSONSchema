export const renderTooltipContentChildren = (text?: any) => {
  if (text === undefined || text === null) return null;
  const s = String(text);
  // Find any http(s) URLs within the string and render them as anchors so tests and users can follow links
  const urlRegex = /(https?:\/\/[^\s]+)/ig;
  if (urlRegex.test(s)) {
    const parts: Array<React.ReactNode> = [];
    let lastIndex = 0;
    s.replace(urlRegex, (match: string, url: string, offset: number) => {
      if (offset > lastIndex) parts.push(s.slice(lastIndex, offset));
      parts.push(<a key={offset} href={match} target="_blank" rel="noreferrer noopener">{match}</a>);
      lastIndex = offset + match.length;
      return match;
    });
    if (lastIndex < s.length) parts.push(s.slice(lastIndex));
    return <>{parts}</>;
  }
  return s;
};
