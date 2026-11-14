import type { Space } from "./space.js";
import type { AuthSession } from "../validators/access.js";

/** Navigation reads taken for the same authenticated principal as the session. */
export interface OperatorBootstrap {
  userId: string;
  spaces: Space[];
  operatorAccess: {
    userId: string;
    isInstanceAdmin: boolean;
    spaceIds: string[];
  };
}

/** Older servers and partial bootstrap failures retain the ordinary session. */
export type OperatorBootstrapSession = AuthSession & { operatorBootstrap?: OperatorBootstrap };
