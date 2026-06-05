const tools = require("./tools.json");
const deepcuts = require("./deepcuts.json");

module.exports = () => {
  const games = tools.filter((t) => t.category === "Game").length;
  const ai = tools.filter((t) => t.category === "AI").length;
  const deepcutsCount = Array.isArray(deepcuts) ? deepcuts.length : (deepcuts.editions || []).length;
  return {
    total: tools.length,
    games,
    ai,
    utility: tools.length - games - ai,
    deepcuts: deepcutsCount,
  };
};
