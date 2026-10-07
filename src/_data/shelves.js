const tools = require("./tools.js");
const extensions = require("./extensions.js");
const deepcuts = require("./deepcuts.json");

module.exports = () => {
  const extGames = extensions.filter((e) => e.schemaCategory === "GameApplication").length;
  const games = tools.filter((t) => t.category === "Game").length + extGames;
  const ai = tools.filter((t) => t.category === "AI").length;
  const total = tools.length + extensions.length;
  const deepcutsCount = Array.isArray(deepcuts) ? deepcuts.length : (deepcuts.editions || []).length;
  return {
    total,
    games,
    ai,
    utility: total - games - ai,
    deepcuts: deepcutsCount,
  };
};
