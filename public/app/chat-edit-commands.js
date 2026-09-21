// Deterministic, inspectable commands. Never ask AI to invent provider outcomes or codes.
// Kept separate from DOM logic so parsing and split distribution can be tested.
(function installAurexChatCommands(global) {
  const number = (value) => Number(value);
  function parse(input) {
    const text = String(input || '').trim().replace(/\s+/g, ' ');
    const lower = text.toLowerCase();
    if (!text) return { action: 'help' };
    if (/^(?:help|commands|what can you do|how does this work)\??$/i.test(text)) return { action: 'help' };
    if (/\b(?:combine|merge|convert)\b/i.test(text) && /\b(?:codes?|tickets?|slips?|bookmakers?|bet9ja|1xbet|betano)\b/i.test(text))
      return { action: 'unsupported' };
    const split = /\bsplit\b(?:\s+\w+){0,5}?\s+(?:into|in|to)\s+(\d+)\s*(?:parts?|slips?|tickets?)?\b/i.exec(text);
    if (split) return { action: 'split', count: number(split[1]) };
    const change = /\b(?:change|replace|switch|edit|swap)\s+(?:the\s+)?(?:game|pick|selection|#)\s*#?(\d+)(?:\s+(?:to|with|for)\s+(.+))?$/i.exec(text);
    if (change) return { action: 'change', index: number(change[1]), requestedMarket: change[2]?.trim() || '' };
    const weak = /\b(?:remove|drop|delete|cut)\s+(?:(\d+)\s+)?(?:the\s+)?weakest(?:\s+(\d+))?(?:\s+(?:games?|picks?|selections?))?\b/i.exec(text);
    if (weak) return { action: 'weakest', count: number(weak[1] || weak[2] || '1') };
    const remove = /\b(?:remove|drop|delete|cut)\s+(?:the\s+)?(?:game|pick|selection|#)\s*#?(\d+)\b/i.exec(text);
    if (remove) return { action: 'remove', index: number(remove[1]) };
    const removeName = /^(?:remove|drop|delete)\s+(.+)$/i.exec(text);
    if (removeName) return { action: 'remove_name', name: removeName[1].trim() };
    const target = /\b(?:trim|reduce|cut|make|give me|target|build|generate|bring(?:\s+it)?|get(?:\s+me)?|i want)\b.*?\b(?:to|at|of|around|about)?\s*(\d+(?:\.\d+)?)\s*(?:x\b|odds\b)/i.exec(text) ||
      /^(?:trim|reduce|cut)\s+(?:this\s+)?(?:slip\s+)?(?:to\s+)?(\d+(?:\.\d+)?)$/i.exec(text);
    if (target) return { action: 'target', target: number(target[1]) };
    if (/^(?:generate|create|book|make)(?:\s+(?:the|a|my|new))?\s*(?:booking\s*)?code(?:\s+(?:now|please))?\b/i.test(text))
      return { action: 'generate' };
    if (/\b(?:reanaly[sz]e|refresh|rank|score|review)\b/i.test(lower)) return { action: 'reanalyze' };
    if (/^(?:show|list|display|what(?:'s| is))\s+(?:my\s+)?(?:slip|games|picks|ticket)\b/i.test(lower)) return { action: 'list' };
    if (/^[a-z0-9]{4,20}$/i.test(text) && /[a-z]/i.test(text)) return { action: 'import', code: text.toUpperCase() };
    return { action: 'help' };
  }
  // Balance the count and log-odds, without duplicating or inventing a selection.
  function splitEven(selections, count) {
    if (!Number.isSafeInteger(count) || count < 2 || count > 6 || count > selections.length) return null;
    const groups = Array.from({ length: count }, () => []);
    const weight = Array(count).fill(0);
    for (const pick of [...selections].sort((a, b) => b.odds - a.odds)) {
      let index = 0;
      for (let i = 1; i < count; i += 1) {
        if (groups[i].length < groups[index].length ||
          (groups[i].length === groups[index].length && weight[i] < weight[index])) index = i;
      }
      groups[index].push(pick);
      weight[index] += Math.log(pick.odds);
    }
    return groups.map((items) => [...items].sort((a, b) => b.confidence - a.confidence));
  }
  global.AurexChatCommands = Object.freeze({ parse, splitEven });
})(globalThis);
