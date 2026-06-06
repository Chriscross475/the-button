// Asset database entry point. Importing this registers every built-in asset
// (via ./library) and re-exports the registry API. Scenes do:
//   import { createAsset } from '../assets';
//   const duck = createAsset('duck');
import './library';
import './infra';
export { createAsset, hasAsset, assetIds, defineAsset, type AssetFactory } from './registry';
export { type TrackParams, type TunnelFaceParams, makeRng } from './infra';
