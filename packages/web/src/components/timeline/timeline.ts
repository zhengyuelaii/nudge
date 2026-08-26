import TimelineContent from "./TimelineContent.vue";
import TimelineItem from "./TimelineItem.vue";
import TimelineMedia from "./TimelineMedia.vue";
import TimelineRoot from "./TimelineRoot.vue";

export const Timeline = {
  Root: TimelineRoot,
  Item: TimelineItem,
  Media: TimelineMedia,
  Content: TimelineContent,
} as const;
