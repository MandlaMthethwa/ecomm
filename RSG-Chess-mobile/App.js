import React, { Component } from "react";
import {
  View,
  Dimensions,
  ToastAndroid,
  NativeModules,
  AsyncStorage,
  BackHandler,
  Alert
} from "react-native";

import firebase from '@react-native-firebase/app';
import '@react-native-firebase/analytics';
import '@react-native-firebase/crashlytics';

import admob, {
  MaxAdContentRating,
  InterstitialAd,
  AdEventType
} from '@react-native-firebase/admob';

import includes from "lodash/includes";
import { createDrawerNavigator } from "react-navigation";
import { WebView } from 'react-native-webview';

import { Game } from "rsg-chess";
import { html } from "./src/scripts/AI";
import { combineParams, stringifyTurnsReport } from "./src/scripts/utils";
import { strings, colorPalettes } from "./src/config";
import NavigationContext from "./src/components/NavigationContext";
// Note: React Navigation: https://stackoverflow.com/a/61029650/5223654

import Play from "./src/pages/Play";
import Settings from "./src/pages/Settings";
import Privacy from "./src/pages/Privacy";
import NewGame from "./src/pages/NewGame";
import Menu from "./src/pages/Menu";
import SplashScreen from "react-native-splash-screen";

import installPuzzleHelper, { simpleSEN } from "./src/scripts/puzzleHelper";
import Puzzles from "./src/pages/Puzzles";

type Props = {};
installPuzzleHelper(Game);
let game = Game.prototype.initializeGame();

// Set up Firebase

// Set up AdMob
admob()
  .setRequestConfiguration({
    maxAdContentRating: MaxAdContentRating.PG,
    tagForChildDirectedTreatment: true,
    tagForUnderAgeOfConsent: false,
  })
  .then(() => { /* Request config successfully set! */ });

let interstitial = InterstitialAd.createForAdRequest("ca-app-pub-3522556458609123/5974831399", {});
interstitial.load();

interstitial.onAdEvent(type => {
  if (type === AdEventType.CLOSED) {
    interstitial.load();
  }
});

let language = NativeModules.I18nManager.localeIdentifier.split(`_`)[0];
firebase.crashlytics().setAttribute("initial_language", language);

const supportedLangs = Object.keys(strings.languages);
if (!includes(supportedLangs, language)) language = "en";

const supportedPalettes = Object.keys(colorPalettes);

export default class App extends Component<Props> {
  /// CLASS METHODS ///
  constructor() {
    super();
    this.state = {
      width: Dimensions.get("window").width,
      height: Dimensions.get("window").height,
      lang: language,
      palette: "default",
      rotated: false,
      showValidMoves: true,
      selected: null,
      checkmate: null,
      playAgainstAI: null,
      puzzle: null,
      isAIThinking: false,
      promotionParams: null
    };

    Dimensions.addEventListener("change", () => {
      this.setState({
        width: Dimensions.get("window").width,
        height: Dimensions.get("window").height
      });
    });

    this.NavigationComponent = createDrawerNavigator({
      Menu: {
        screen: Menu,
      },
      Play: {
        screen: Play
      },
      Puzzles: {
        screen: Puzzles
      },
      Settings: {
        screen: Settings
      },
      NewGame: {
        screen: NewGame
      },
      Privacy: {
        screen: Privacy
      }
    });
  }

  componentDidMount = () => {
    const backAction = () => {
      BackHandler.exitApp();
      return true;
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction
    );

    // Make sure the splash screen is gone
    SplashScreen.hide();

    // Get the settings from the storage
    try {
      AsyncStorage.getItem("@RSGChess:lang").then(value => {
        if (value) {
          if (includes(supportedLangs, value)) this.setState({ lang: value });
        }
      });
    } catch (error) {
      firebase.analytics().logEvent(`language_error`);
      firebase
        .crashlytics()
        .recordError(
          0,
          `Getting error: ${error.toString()}, when trying to get the lang from the storage.`
        );
    }
    try {
      AsyncStorage.getItem("@RSGChess:showValidMoves").then(value => {
        if (value) {
          if (typeof JSON.parse(value) === "boolean")
            this.setState({ showValidMoves: JSON.parse(value) });
        }
      });
    } catch (error) {
      firebase.analytics().logEvent(`validMoves_error`);
      firebase
        .crashlytics()
        .recordError(
          0,
          `Getting error: ${error.toString()}, when trying to get the 'showValidMoves' config from the storage.`
        );
    }

    try {
      AsyncStorage.getItem("@RSGChess:palette").then(value => {
        if (value) {
          if (includes(supportedPalettes, value))
            this.setState({ palette: value });
        }
      });
    } catch (error) {
      firebase.analytics().logEvent(`palette_error`);
      firebase
        .crashlytics()
        .recordError(
          0,
          `Getting error: ${error.toString()}, when trying to get the current pallete from the storage.`
        );
    }
  };

  /// HELPERS ///
  setRotation = value => {
    this.setState({
      rotated: value
    });
  };

  updateValidMovesConfig = value => {
    AsyncStorage.setItem(
      "@RSGChess:showValidMoves",
      JSON.stringify(value)
    ).then(ev => {
      this.setState({ showValidMoves: value });
      firebase.analytics().logEvent(`update_validMoves_configuration`);
    });
  };

  updateLang = value => {
    if (includes(supportedLangs, value))
      AsyncStorage.setItem("@RSGChess:lang", value).then(ev => {
        this.setState({ lang: value });
        firebase.analytics().logEvent(`update_language`);
      });
  };

  updatePalette = value => {
    if (includes(supportedPalettes, value))
      AsyncStorage.setItem("@RSGChess:palette", value).then(ev => {
        this.setState({ palette: value });
        firebase.analytics().logEvent(`update_palette`);
        firebase.analytics().logEvent(`set_${value}_palette`);
      });
  };

  promoteAI = (pawn, x, y, color) => {
    ToastAndroid.show(
      strings.AIPromoted[this.state.lang],
      ToastAndroid.LONG,
      ToastAndroid.BOTTOM
    );
    game.promotePawn(pawn, x, y, color, "queen");
    firebase.analytics().logEvent(`AI_promotion`);
  };

  promoteSelectedPawn = piece => {
    const { promotionParams, playAgainstAI, checkmate } = this.state;
    if (promotionParams) {
      piece = piece ? piece : "knight";
      const { x, y, color, pawn } = promotionParams;
      game.promotePawn(pawn, x, y, color, piece);
      this.setState({ promotionParams: null });
      firebase.analytics().logEvent(`promote_pawn`);
      firebase.analytics().logEvent(`promote_pawn_to_${piece}`);

      // Start the AI if there is playAgainstAI mode
      if (playAgainstAI && !checkmate) {
        this.startAI();
      }
    } else {
      firebase
        .analytics()
        .logEvent(`promotion_state_problem_type_${typeof promotionParams}`);
    }
  };

  selectMode = playAgainstAI => {
    if (playAgainstAI) {
      const { puzzle } = playAgainstAI;

      if (puzzle) {
        this.setState({ playAgainstAI: null, puzzle: puzzle });
        game.initGameFEN(puzzle.fen);
        return;
      }
    }

    this.setState({
      playAgainstAI: playAgainstAI
    });
  };

  startAI = () => {
    this.webView.injectJavaScript(
      `AI(${combineParams(game, this.state.playAgainstAI)})`
    );

    this.setState({ isAIThinking: true });
  };

  /// EVENTS ///
  handlePress = (x, y, ctx) => {
    let {
      selected,
      playAgainstAI,
      isAIThinking,
      lang,
      checkmate,
      puzzle,
    } = this.state;

    if (isAIThinking) {
      ToastAndroid.show(
        strings.AIThinking[lang],
        ToastAndroid.SHORT,
        ToastAndroid.BOTTOM
      );
      return;
    }

    if (selected) {
      // move the selected piece
      let move = game.moveSelected(
        selected,
        { x: x, y: y },
        this.handlePromotion,
        this.handleCheckmate,
        false
      );

      this.setState({ selected: null });

      // use the worker for generating AI movement
      let last = game.turn.length - 1;

      if (
        move &&
        playAgainstAI &&
        last >= 0 &&
        game.turn[last].color === "W" &&
        !checkmate &&
        !move.promotion
      ) {
        this.startAI();
      } else if (!!move && game.turn[last] && puzzle) {
        if (simpleSEN(game.turn[last]) === puzzle.sln) {
          Alert.alert(
            "DONE!",
            "You did it!",
            [{
              text: "OK", onPress: () => {
                this.restartGame();
                ctx.props.navigation.navigate('Puzzles');
              }
            }],
            { cancelable: false }
          );
        } else {
          Alert.alert(
            "NOT DONE!",
            "If this is a mistake, or a bug with the app screenshot it and send to Radi\n\n" + puzzle.fen + "\n\n" + simpleSEN(game.turn[last]),
            [{
              text: "OK", onPress: () => {
                this.restartGame();
                ctx.props.navigation.navigate('Puzzles');
              }
            }],
            { cancelable: false }
          );
        }
      }


      firebase
        .crashlytics()
        .setAttribute("turns", stringifyTurnsReport(game.turn));
    } else {
      let last = game.turn.length - 1;
      if (
        game.board[y][x] &&
        (last >= 0
          ? game.board[y][x].color !== game.turn[last].color
          : game.board[y][x].color === "W")
      ) {
        this.setState({ selected: game.board[y][x] });
      } else {
        game.board[y][x] &&
          ToastAndroid.show(
            strings.invalidMove[lang],
            ToastAndroid.SHORT,
            ToastAndroid.BOTTOM
          );
      }
    }

    firebase.crashlytics().setAttribute("FEN", game.FEN);
    firebase
      .crashlytics()
      .setAttribute("threefold_length", game.threefold.length.toString());
  };

  handlePromotion = (pawn, x, y, color) => {
    this.setState({
      promotionParams: {
        x: x,
        y: y,
        color: color,
        pawn: pawn
      }
    });
  };

  handleReplay = (ctx) => {
    this.restartGame();
    if (Math.floor(Math.random() * 3) !== 2) {
      interstitial.show();
      interstitial.load();
    }
    firebase.analytics().logEvent(`handle_replay`);
    ctx.props.navigation.navigate("Menu");
  }

  restartGame = () => {
    // Set state to null and false, to reset all params
    this.setState({
      selected: null,
      promotionParams: null,
      checkmate: null,
      isAIThinking: false,
      playAgainstAI: null,
      puzzle: null,
    });

    // Initialize new game
    game = Game.prototype.initializeGame();
  };

  handleCheckmate = color => {
    this.setState({ checkmate: color });
    firebase.analytics().logEvent(`checkmate_event`);
    if (color === "D") {
      firebase.analytics().logEvent(`draw`);
    } else if (color === "W") {
      firebase.analytics().logEvent(`black_player_won`);
      if (this.state.playAgainstAI) {
        firebase.analytics().logEvent(`AI_won`);
      }
    } else if (color === "B") {
      firebase.analytics().logEvent(`white_player_won`);
    } else {
      firebase.analytics().logEvent(`unknown_checkmate_event`);
    }
  };

  handleMessage = msg => {
    if (msg && msg.nativeEvent.data) {
      // Track issues if any
      if (typeof msg.nativeEvent.data === "string") {
        firebase
          .crashlytics()
          .setAttribute("handleMessage_data", msg.nativeEvent.data);
      } else if (!JSON.stringify(msg.nativeEvent.data)) {
        firebase
          .crashlytics()
          .setAttribute("webView_message_type", typeof msg.nativeEvent.data);

        firebase
          .crashlytics()
          .recordError(1, "Cannot stringify message from WebView.");
      } else {
        firebase
          .crashlytics()
          .setAttribute(
            "handleMessage_data",
            JSON.stringify(msg.nativeEvent.data)
          );
      }

      msg = JSON.parse(msg.nativeEvent.data);
      const { promoteAI } = this;

      game.moveSelected(
        game.board[msg.from.y][msg.from.x],
        msg.to,
        promoteAI,
        this.handleCheckmate,
        false
      );

      this.setState({ isAIThinking: false });
      firebase
        .crashlytics()
        .setAttribute("turns", stringifyTurnsReport(game.turn));
    } else {
      firebase.crashlytics().setAttribute("handleMessage_data", "undefined");
    }
  };

  render() {
    const {
      handleReplay,
      handlePress,
      NavigationComponent,
      updateLang,
      updatePalette,
      setRotation,
      updateValidMovesConfig,
      promoteSelectedPawn,
      selectMode,
      restartGame
    } = this;

    return (
      <React.Fragment>
        <NavigationContext.Provider
          value={{
            self: this,
            game: game,
            restartGame: restartGame,
            handleReplay: handleReplay,
            updatePalette: updatePalette,
            handlePress: handlePress,
            updateLang: updateLang,
            setRotation: setRotation,
            updateValidMovesConfig: updateValidMovesConfig,
            promoteSelectedPawn: promoteSelectedPawn,
            selectMode: selectMode,
            ...this.state
          }}
        >
          <NavigationComponent />
        </NavigationContext.Provider>
        <View>
          <WebView
            ref={el => (this.webView = el)}
            source={{ html: html }}
            javaScriptEnabled={true}
            onMessage={this.handleMessage}
          />
        </View>
      </React.Fragment>
    );
  }
}

App.defaultProps = {};
