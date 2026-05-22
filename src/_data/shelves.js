const tools = require("./tools.json");

module.exports = () => {
  const games = tools.filter((t) => t.category === "Game").length;
  const ai = tools.filter((t) => t.category === "AI").length;
  return {
    total: tools.length,
    games,
    ai,
    utility: tools.length - games - ai,
  };
};
