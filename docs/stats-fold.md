# Collapsible statistics (preview only)

Knowledge-point mastery and the eight-week calendar use native details/summary controls, initially closed on each entry to the statistics page. Recommendations stay visible outside the mastery disclosure. Clicking the summary or using Enter/Space independently opens or closes either section; hidden practice links are excluded from normal keyboard focus navigation.

Before a statistics repaint, current details.open values are captured. Changing trend range or a midnight calendar refresh therefore preserves disclosure state. This UI state is not stored in learning data or backups. Summary IDs preserve focus during repaint. The underlying mastery calculations and 56 calendar entries are unchanged.

tests/stats-fold.cjs checks 360/390/1440px, empty and populated records, default state, independent pointer/keyboard toggles, range repaint, 44px targets, no horizontal overflow, visible recommendations and the practice shortcut. The test supports STATS_SITE for isolated checks of a deployed preview. No physical-device verification is claimed.
