# TORCS Web Caveats

## Material Masks Are Channel Controls, Not Cryptomatte IDs

The current `car7-trb1` material-mask path uses a packed RGB channel-control
texture, not a cryptomatte-style material-ID texture.

Current convention:

```text
red channel   = paint / clearcoat influence
green channel = decal, livery, and text influence
blue channel  = dark trim, vents, and carbon-like details
alpha channel = reserved for future use
```

This means the renderer treats each channel as a scalar control map. It does
not interpret exact colors as discrete material IDs. For example, a red pixel is
not "material 1" in a palette; it is a high value in the paint/clearcoat control
channel.

This was chosen for the first implementation because it works with stock
Three.js material maps such as `clearcoatMap` and `roughnessMap`, keeping the
modern renderer path simple and compatible with the existing WebGPU setup.

A true material-ID or cryptomatte-like workflow would require a different
shader/material path. In that model, exact encoded colors would correspond to
semantic materials such as paint, decal, trim, metal, glass detail, or light
detail. That would offer more explicit per-pixel material selection, but it
would also need custom shader or TSL logic, edge/anti-aliasing rules, and more
careful authoring validation.

For now, object classes provide coarse semantic materials and the RGB mask
provides fine per-pixel controls within the body atlas.
