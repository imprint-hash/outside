// Plans page: looks only. Qloo's strands in the header and a slow shine on
// the "Spotlight" label. The page is complete without this file.
import("/fx/strands.js")
  .then(({ mountStrands }) => mountStrands(document.getElementById("plansStrands"), { intensity: 0.9, energy: 0.55, speed: 0.6 }))
  .catch(() => {});
import("/fx/shiny-text.js")
  .then(({ shinyText }) => shinyText(document.getElementById("spotWord"), { shineColor: "#FFF6E6", speed: 2.4, delay: 2.6, shineWidth: 40 }))
  .catch(() => {});
