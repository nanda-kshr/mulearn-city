export type CityResident = {
  muid: string;
  name: string;
  initials: string;
  organization: string;
  interest: string;
  karma: number;
  karmaLabel: string;
  totalEvents: number;
  recentEvents: number;
  recentKarma: number;
  lastActiveLabel: string;
  latestTask: string;
  buildingHeight: number;
  glow: number;
  hue: number;
};

export type CityChunk = {
  key: string;
  x: number;
  z: number;
  pageIndex: number;
  residents: CityResident[];
};

export type CityChunkPayload = {
  pageIndex: number;
  totalPages: number;
  residents: CityResident[];
};
