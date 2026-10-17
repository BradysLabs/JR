# Animal Buyer

Animal Jam Classic animal browser and buyer.

## Animal data

The animal database was derived from Animal Jam Classic's animal definition data.

Animal definitions:
- Defpack: 1003

Animal names:
- Text/string pack: 10230

The `id` field from defpack 1003 is the Animal ID used by the plugin.

The `titleStrRef` field is resolved through defpack 10230 to obtain the animal name.

## Included animals

The plugin includes all 53 animal definitions currently mapped:

1. Tiger
2. Eagle
3. Deer
4. Wolf
5. Koala
6. Panda
7. Monkey
8. Bunny
9. Hyena
10. Otter
11. Polar Bear
12. Owl
13. Rhino
14. Penguin
15. Crocodile
16. Elephant
17. Lion
18. Seal
19. Dolphin
20. Shark
21. Octopus
22. Sea Turtle
23. Horse
24. Penguin
25. Fox
26. Giraffe
27. Kangaroo
28. Arctic Wolf
29. Snow Leopard
30. Raccoon
31. Cheetah
32. Lynx
33. Arctic Fox
34. Goat
35. Falcon
36. Pig
37. Sloth
38. Lemur
39. Toucan
40. Sheep
41. Cougar
42. Coyote
43. Flamingo
44. Red Panda
45. Clydesdale Horse
46. Sabertooth
47. Direwolf
48. Skunk
49. Great Horned Owl
50. Fennec Fox
51. Camel
52. Arabian Horse
53. Moose

## Purchase packet

The request includes fields from the current game session, so the plugin does
not use a hard-coded packet. Make a normal animal purchase in the game first;
Animal Buyer captures that outgoing request and substitutes only the selected
Animal ID. The captured template is kept in memory for the current plugin
session and is discarded when the plugin closes.

The generated request is editable. The Purchase button sends the text currently
in the packet field, after checking that it is an outgoing `aa` packet with a
numeric Animal ID. After sending, check the game for the server's result; a
successful send only confirms that JR passed the request to the active
game connection.

## Features

- Search by name
- Search by ID
- Select animal
- View Animal ID
- View members status
- View cost
- View title string reference
- View generated packet
- Purchase selected animal
- Recent animal history
- Favorites
- Enter-key controls
