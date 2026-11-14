# Changelog

## [0.5.0](https://github.com/mkuhlmann/caduceus/compare/v0.4.0...v0.5.0) (2026-11-14)


### Features

* ask in the app's own dialogs instead of the browser's ([4b8d8da](https://github.com/mkuhlmann/caduceus/commit/4b8d8da7b25a0dae1fdddb975cc82a30132651e9))
* catch up on everything that changed while the app was away ([0062836](https://github.com/mkuhlmann/caduceus/commit/0062836380e9839f0a6c04368d9abc44a3ddbae5))
* create and edit schedules that run a script without the agent ([d24908f](https://github.com/mkuhlmann/caduceus/commit/d24908f9a9d6642fdbcededf218888d6f4f05a20))
* dictate a message with the microphone ([2e4389f](https://github.com/mkuhlmann/caduceus/commit/2e4389ffb6c33cd45fef99f288d8368e8a46c359))
* draw a bot in the colour of the face Hermes drew for it ([ea722d9](https://github.com/mkuhlmann/caduceus/commit/ea722d9f2290315563343fb89abda73abbdc4953))
* end the working line with rising dots instead of a pulsing one ([838c304](https://github.com/mkuhlmann/caduceus/commit/838c304fc67af791cb570856eec7434fb47c833f))
* keep a bot's face at the bottom of its reply ([3d17d6b](https://github.com/mkuhlmann/caduceus/commit/3d17d6b97fa51347104287067783aef2395d5c1e))
* keep a working bot's face beside its newest output ([6463ff2](https://github.com/mkuhlmann/caduceus/commit/6463ff23ae70c2e01ce7767288480308c3a0a067))
* keep the message colour and speed settings on the server ([3b5a65d](https://github.com/mkuhlmann/caduceus/commit/3b5a65d38dd993ebfe809e89c863e2dde33d20a5))
* let a bot be petted ([83bb5a9](https://github.com/mkuhlmann/caduceus/commit/83bb5a96809ac31475b6d41baac6426f906f1ff6))
* match a bot's body to the outline of the face Hermes drew ([2cace4d](https://github.com/mkuhlmann/caduceus/commit/2cace4d163003ef1e9bbe3af50294eb4b4a1b72f))
* pick a reply up where it broke off after the connection drops ([b30852a](https://github.com/mkuhlmann/caduceus/commit/b30852aec24fb5cc0057259dc0d4b5848fa920b4))
* resize the left sidebar by dragging its edge ([8fcfbcf](https://github.com/mkuhlmann/caduceus/commit/8fcfbcfbcc13919eaeb900e0f1939f17cb780298))
* share a bot's gateway key instead of replacing it ([e362e75](https://github.com/mkuhlmann/caduceus/commit/e362e75086e619e8ae2cbfe7d4d4331ca687f8d5))
* show a question mark on a bot asking you something ([eaa5b6a](https://github.com/mkuhlmann/caduceus/commit/eaa5b6ae17994bedfe5bb1dbf4edbb3fee3d9d48))
* show the bots on an empty new chat on phones ([511352e](https://github.com/mkuhlmann/caduceus/commit/511352e15021f13151030e5f4a65c4523ffc1379))
* split settings into Caduceus and Hermes, with the connection inside ([e7fc2e8](https://github.com/mkuhlmann/caduceus/commit/e7fc2e8427a1e8ccc3da9dd1a5b91666e6b34d31))


### Bug Fixes

* draw the bot's face unless its picture is a real photo ([230bb00](https://github.com/mkuhlmann/caduceus/commit/230bb00fcd7866d31ec6cb35549db5bb126ee0ab))
* keep a Bot Chat turn shown across a watch re-attach ([d4db09c](https://github.com/mkuhlmann/caduceus/commit/d4db09cc23bb70eb7c364a6be5bac25f0741902d))
* keep following a reply when the connection drops instead of showing an error ([41e84fd](https://github.com/mkuhlmann/caduceus/commit/41e84fd2092b94b6bfcf2461162f75d5dbcf518e))
* keep the header in place while a phone's keyboard is up ([dceeae2](https://github.com/mkuhlmann/caduceus/commit/dceeae2f109c56b0477cc0ea81700da882993f1b))
* keep the keyboard down on phones until the message box is tapped ([0004cea](https://github.com/mkuhlmann/caduceus/commit/0004ceafad5125a96366d43408dbb0e326531488))
* offer to reconnect a bot whose gateway turns down Caduceus's key ([37a98e9](https://github.com/mkuhlmann/caduceus/commit/37a98e96e4ac370000009efd17fc5d824e29b191))
* share read state across devices ([d80109d](https://github.com/mkuhlmann/caduceus/commit/d80109d8ebcb0423de239ab5df50679695d5c193))
* show a message sent from another device above the bot's reply ([c71c7f1](https://github.com/mkuhlmann/caduceus/commit/c71c7f1b39316b85f4bf95d168f14c9a8b343b17))
* show a script job's runs as output instead of chats that do not exist ([32bdb3d](https://github.com/mkuhlmann/caduceus/commit/32bdb3d9386379d721219ee883a21a915593a7c7))
* show the agent's clarify questions and let you answer them ([d4b0621](https://github.com/mkuhlmann/caduceus/commit/d4b062172f0bc7f964f2fb1ffaa00ac174825479))
* show your message once while its reply runs, after switching chats ([56ed9c9](https://github.com/mkuhlmann/caduceus/commit/56ed9c96defa988e18c41c52ca0e75ecad853524))
* stop relaying the browser's fetch metadata to Hermes ([f8effeb](https://github.com/mkuhlmann/caduceus/commit/f8effebe09c245fa629897637ba2c7a55f28ecd1))
* wrap long words in chat messages on phones instead of widening the chat ([5c940a6](https://github.com/mkuhlmann/caduceus/commit/5c940a647560aabe6f95bccc99ffbc7eed3fd184))

## [0.4.0](https://github.com/mkuhlmann/caduceus/compare/v0.3.0...v0.4.0) (2026-11-12)


### Features

* add a graphite colour scheme for dark mode ([83684c1](https://github.com/mkuhlmann/caduceus/commit/83684c112d66eb1b2b9e22d34503d4f6269b013b))
* bot group chats hosted by the Hermes gateway ([c1283fa](https://github.com/mkuhlmann/caduceus/commit/c1283faefad432cf26de90502f1861c3394a7e41))
* bot mode with Hermes bots, mentions and routines ([db3eaf2](https://github.com/mkuhlmann/caduceus/commit/db3eaf21277647da47794d678f4f4c8949efc4c1))
* colour my messages in a bot's chat with the bot's colour ([44f47b3](https://github.com/mkuhlmann/caduceus/commit/44f47b30aeda7dee87698f31da5c7003b435f2f8))
* load chats from their end, older pages as the reader scrolls up ([e6c1f53](https://github.com/mkuhlmann/caduceus/commit/e6c1f53063a1e75507850ee82d6d818abfe6b3d1))
* make graphite the default dark colours ([9440683](https://github.com/mkuhlmann/caduceus/commit/944068383c980642f2e7b627ee99a80413ec178d))
* open bots and group chats from the chat list in place ([f34229d](https://github.com/mkuhlmann/caduceus/commit/f34229d63dcde362c730e08a6284f9476a981376))
* paint chats from a saved copy and compress relay answers ([ab51cdf](https://github.com/mkuhlmann/caduceus/commit/ab51cdf1711bea98b12b703c79eab271f4e9ef38))
* quieter composer focus and a bot-coloured send button ([170a364](https://github.com/mkuhlmann/caduceus/commit/170a364ba86146ffee9c14f0c55d3f960aa42300))
* say on the connection page whether bots' chats show live ([6f9f2fc](https://github.com/mkuhlmann/caduceus/commit/6f9f2fcb1b65d61b64e8ada2a73d9976e49bb0ec))
* show any turn in an open bot's chat live ([fca678d](https://github.com/mkuhlmann/caduceus/commit/fca678d02a249066f9e02d137b0ec9fb39490ee9))
* show bots as an adaptive bento above the chat list ([7dd6e7d](https://github.com/mkuhlmann/caduceus/commit/7dd6e7df0266156d9622a874f7a7e0070e87d8b1))
* show bots' chats live and how fast each reply ran ([c7819d6](https://github.com/mkuhlmann/caduceus/commit/c7819d6bbec90dc4247c0bf03846062d8cff3307))
* show prompt, cache and output tokens in the speed line ([53eec06](https://github.com/mkuhlmann/caduceus/commit/53eec06e87abf0d63272fc3b2dbeae51e527db37))


### Bug Fixes

* let the bot bento scroll away with the chat list ([0198c2f](https://github.com/mkuhlmann/caduceus/commit/0198c2f614849ad5a0c38fa5c92b0b1b4bc3e6b3))
* switch between chats and bot chats without the page entrance ([dcc1f83](https://github.com/mkuhlmann/caduceus/commit/dcc1f83b3d2dba7386a7aba3b769a22e61970fa3))

## [0.3.0](https://github.com/mkuhlmann/caduceus/compare/v0.2.1...v0.3.0) (2026-11-06)


### Features

* install Caduceus as an app on phones ([69e4fc9](https://github.com/mkuhlmann/caduceus/commit/69e4fc9f661306bc63f9ed1ad9dd1f3764627188))
* keep the chat scrolled to the latest output while a run grows it ([61feb36](https://github.com/mkuhlmann/caduceus/commit/61feb36d4488df38a9c43ff5ecce2f649af8f0a4))
* paint revisited pages at once and animate loading ([de73812](https://github.com/mkuhlmann/caduceus/commit/de7381252e9abaf4d5f55ce6fb1b619edaf7ee55))

## [0.2.1](https://github.com/mkuhlmann/caduceus/compare/v0.2.0...v0.2.1) (2026-10-30)


### Bug Fixes

* open the Linux app where user namespaces are blocked ([bbed286](https://github.com/mkuhlmann/caduceus/commit/bbed28644e360d16c7405374b1ee9dc0e8580d4e))

## [0.2.0](https://github.com/mkuhlmann/caduceus/compare/v0.1.0...v0.2.0) (2026-10-30)


### Features

* release desktop apps and Docker images with release-please ([4df120c](https://github.com/mkuhlmann/caduceus/commit/4df120c43f84df72b80a9167bf72dabc99fe8bde))
