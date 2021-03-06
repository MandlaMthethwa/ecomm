import React, { Component } from "react";
import { View, Text, Button } from "react-native";
import firebase from '@react-native-firebase/app';
import '@react-native-firebase/analytics';
import { strings, globalStyles } from "../config";
import NavigationContext from "../components/NavigationContext";

export default class NewGame extends Component<Props> {
  static navigationOptions = {
    title: "Replay",
    header: null,
    drawerLabel: () => (
      <NavigationContext.Consumer>
        {data => {
          return (
            <Text style={[globalStyles.drawerItemLabel, { color: "#b70" }]}>
              {strings.newGame[data.lang]}
            </Text>
          );
        }}
      </NavigationContext.Consumer>
    )
  };

  componentDidMount() {
    firebase.analytics().logEvent(`drawer_replay`);
  }

  render() {
    return (
      <View>
        <Text>...</Text>
        <NavigationContext.Consumer>
          {data => {
            data.handleReplay(this);
          }}
        </NavigationContext.Consumer>
      </View>
    );
  }
}
