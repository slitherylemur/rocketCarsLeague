// CharacterAutoLoads must be OFF before the first player is admitted: the
// place has NO SpawnLocation anywhere, so an engine auto-loaded character
// stands at the world origin (0,0,0). initializePlayer.server.ts also sets
// this, but only after requiring its large import graph — on a slow
// production cold boot the first joiner can beat that window (never seen in
// Studio, where the server is fully up before Play connects). This script has
// zero imports so it runs as early as a server Script can.
game.GetService("Players").CharacterAutoLoads = false;
