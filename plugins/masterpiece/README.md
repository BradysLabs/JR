# Masterpiece Studio

Turn any picture into an Animal Jam Classic masterpiece file, or open a masterpiece file to get the picture back out.

## Create

1. Drop a picture onto the canvas, click it to choose a file, or paste with **Ctrl+V**.
2. Choose how it fits the 760 × 460 masterpiece:
   - **Fill** covers the whole canvas and crops the edges. Drag to move it, scroll or use **Zoom** to zoom in.
   - **Fit** shows the whole picture with a background color you pick.
   - **Stretch** stretches it to 760 × 460.
3. Set the **Quality** (higher looks better but makes a bigger file). The file size shows under the canvas.
4. Your **player uuid** is filled in automatically when you're logged in through JR. Click **Detect** if it's empty.
5. Click **Save masterpiece file**. Every file is checked after it's made, before it's saved.

Then load the file in Animal Jam's masterpiece tool and submit it the normal way. Animal Jam reviews every masterpiece before it goes live.

Only use pictures you made or have the right to use.

## Open

Drop a `.ajart` or `.ajgart` file to see the picture inside. You need the uuid of the account that made it, since each file is locked to its owner's uuid. From there you can save the picture as an image or send it to **Create** to edit it.

## How the file works

A masterpiece file holds the picture (JPEG), its type (`aja2id` for `.ajart`) and the owner's uuid. That data is packed (AMF3), compressed (zlib) and encrypted (AES-128) with a key made from the owner's uuid.

Based on the masterpiece encoder in animaljam.js by Sxip, used with permission. Files are byte-for-byte identical to the ones animaljam.js makes.
