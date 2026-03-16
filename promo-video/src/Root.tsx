import { Composition } from "remotion";
import { LXXIPromo } from "./LXXIPromo";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="LXXIPromo"
        component={LXXIPromo}
        durationInFrames={2700}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
