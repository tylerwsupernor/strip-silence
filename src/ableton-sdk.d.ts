declare module "@ableton-extensions/sdk" {
  // Minimal types to satisfy this project's imports for local builds.
  export type ArrangementSelection = {
    selected_lanes: any[];
    time_selection_start: number;
    time_selection_end: number;
  };

  export type ActivationContext = unknown;

  export function initialize(activation: ActivationContext, apiVersion: string): any;

  export class DataModelObject {
    // base class for data model objects
  }

  export class AudioTrack<TVersion extends string = string> extends DataModelObject {
    name: string;
    clearClipsInRange(start: number, end: number): Promise<void>;
  }
}

