// PTZ (pan, tilt, zoom) of a camera, through Frigate's Home Assistant integration.
// PREPARED, NOT IN USE YET: nothing in the panel calls this. It is the one place the camera
// box will talk to when the controls are added, so the box and the plan already carry what
// they need:
//   - the plan marks a camera that moves with `"ptz": true` (Frente and Sala, whose ONVIF
//     reports pan/tilt and zoom: Frigate's /api/<camera>/ptz/info);
//   - the box (camera/view.js) has an empty `.cam-ptz` layer over the video for the arrows;
//   - the commands go to the `frigate.ptz` action, the same thing Frigate's own UI does:
//       action: 'move'   argument: 'up' | 'down' | 'left' | 'right'
//       action: 'zoom'   argument: 'in' | 'out'
//       action: 'stop'
//       action: 'preset' argument: <preset name>
//     A move keeps going until 'stop' (press and hold an arrow, release to stop).
//
// To turn it on: show controls in the `.cam-ptz` layer when createPtz() returns something,
// wire press/release to move()/stop(), and list presets() if the camera has any.

export const PTZ_MOVES = ['up', 'down', 'left', 'right'];

/**
 * The PTZ controller of `camera` (a plan entry, `link.id` = camera.xxx), or null when the
 * camera does not move. `ha` is the connection of camera/access.js.
 */
export function createPtz(camera, ha) {
  if (!camera?.ptz || !camera.link?.id) return null;
  const entity = camera.link.id;
  const send = (action, argument) => ha.call({
    type: 'call_service', domain: 'frigate', service: 'ptz',
    service_data: { action, ...(argument != null && { argument }) }, target: { entity_id: entity },
  });
  return {
    entity,
    move: (direction) => send('move', direction),
    zoom: (direction) => send('zoom', direction),
    stop: () => send('stop'),
    preset: (name) => send('preset', name),
  };
}
