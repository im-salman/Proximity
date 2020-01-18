import { useMutation } from '@apollo/react-hooks';
import appleAuth, { AppleAuthCredentialState, AppleAuthRequestOperation, AppleAuthRequestScope, AppleButton } from '@invertase/react-native-apple-authentication';
import { GoogleSignin } from '@react-native-community/google-signin';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { responsiveHeight, responsiveWidth } from 'react-native-responsive-dimensions';
import SplashScreen from 'react-native-splash-screen';
import { useNavigation } from 'react-navigation-hooks';
import GoogleLogo from '../../../assets/svg/google-logo.svg';
import LoginBanner from '../../../assets/svg/login-banner.svg';
import { Errors, IconSizes, Routes } from '../../constants';
import { AppContext } from '../../context';
import client from '../../graphql/client';
import { MUTATION_CREATE_USER } from '../../graphql/mutation';
import { QUERY_SIGNIN, QUERY_USER_EXISTS } from '../../graphql/query';
import { Button, ConfirmationModal, LoadingIndicator } from '../../layout';
import { ThemeStatic, Typography, ThemeVariant } from '../../theme';
import { ThemeColors } from '../../types/theme';
import { handleLoginError, signOut } from '../../utils/authentication';
import { crashlytics } from '../../utils/firebase';
import { welcomeNotification } from '../../utils/notifications';
import { generateUUID } from '../../utils/shared';
import { loadToken, saveToken } from '../../utils/storage';
import TermsAndConditionsBottomSheet from './components/TermsAndConditionsBottomSheet';

const { FontWeights, FontSizes } = Typography;

const LoginScreen: React.FC = () => {
  const { theme, themeType, updateUser } = useContext(AppContext);
  const { navigate } = useNavigation();
  const [createUser] = useMutation(MUTATION_CREATE_USER);
  const [initializing, setInitializing] = useState(true);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [termsConfirmationModal, setTermsConfirmationModal] = useState(false);
  const [authState, setAuthState] = useState({});

  const termsAndConditionsBottomSheetRef = useRef();

  const navigateToApp = async (token: string) => {
    try {
      const { data: { signIn: { id, avatar, handle } } } = await client
        .query({
          query: QUERY_SIGNIN,
          variables: { token }
        });
      updateUser({ id, avatar, handle });
      welcomeNotification();
      navigate(Routes.App);
    } catch {
      if (!__DEV__) {
        signOut();
      }
    }
  };

  const initialize = async () => {
    try {
      const token = await loadToken();
      navigateToApp(token);
    } catch ({ message, name: errorType }) {
      handleLoginError(errorType);
      setInitializing(false);
    }
    SplashScreen.hide();
  };

  useEffect(() => {
    initialize();
  }, []);

  const termsConfirmationToggle = () => {
    setTermsConfirmationModal(!termsConfirmationModal);
  };

  const saveTokenAndNavigate = async (token: string) => {
    await saveToken(token);
    setGoogleLoading(false);
    setAppleLoading(false);
    setAuthState({});
    navigateToApp(token);
  };

  const processNewUser = async () => {
    termsConfirmationToggle();
    //@ts-ignore
    const { token, avatar, name, email } = authState;
    await createUser({ variables: { token, avatar, name, email } });
    await saveTokenAndNavigate(token);
  };

  const processSignIn = async (token: string, avatar: string | null, name: string | null, email: string) => {
    const { data: { userExists } } = await client.query({ query: QUERY_USER_EXISTS, variables: { token } });
    if (!userExists) {
      setAuthState({ token, avatar, name, email });
      termsConfirmationToggle();
    }
    await saveTokenAndNavigate(token);
  };

  const onGoogleSignIn = async () => {

    if (googleLoading) return;

    try {
      setGoogleLoading(true);
      const data = await GoogleSignin.signIn();
      const { user: { id: token, name, photo, email } } = data;

      await processSignIn(token, photo, name, email);
    } catch ({ message }) {
      setGoogleLoading(false);
      crashlytics.recordCustomError(Errors.SIGN_IN, message);
    }
  };


  const onAppleSignIn = async () => {

    if (appleLoading) return;

    try {
      setAppleLoading(true);
      const appleAuthRequestResponse = await appleAuth.performRequest({
        requestedOperation: AppleAuthRequestOperation.LOGIN,
        requestedScopes: [AppleAuthRequestScope.EMAIL, AppleAuthRequestScope.FULL_NAME],
      });

      const credentialState = await appleAuth.getCredentialStateForUser(appleAuthRequestResponse.user);

      if (credentialState === AppleAuthCredentialState.AUTHORIZED) {

        alert(JSON.stringify(appleAuthRequestResponse));
        return;
        const token = generateUUID();
        const { email, fullName } = appleAuthRequestResponse;
        // @ts-ignore
        const { givenName, middleName, familyName } = fullName;
        const name = `${givenName} ${middleName} ${familyName}`.trim();
        // @ts-ignore
        await processSignIn(token, '', name, email);
      }
    } catch ({ message }) {
      setAppleLoading(false);
      crashlytics.recordCustomError(Errors.SIGN_IN, message);
    }
  };

  let content = <LoadingIndicator color={ThemeStatic.accent} size={IconSizes.x1} />;
  let appleSignInButton;

  if (Platform.OS === 'ios') {
    if (appleLoading) {
      appleSignInButton = (
        <View style={styles().loadingAppleLogin}>
          <LoadingIndicator color={ThemeStatic.accent} size={IconSizes.x0} />
        </View>
      );
    } else {
      const buttonThemeVariant = themeType === ThemeVariant.light ? AppleButton.Style.BLACK : AppleButton.Style.WHITE; 
      appleSignInButton = (
        <AppleButton
          style={styles().appleSignIn}
          buttonStyle={buttonThemeVariant}
          buttonType={AppleButton.Type.SIGN_IN}
          onPress={() => onAppleSignIn()}
        />
      );
    }
  }

  if (!initializing) {
    content = (
      <>
        <View style={styles(theme).content}>
          <Text style={styles(theme).titleText}>Proximity</Text>
          <Text style={styles(theme).subtitleText}>
            Welcome to a open
            source social media where you are
            more than a statistics
        </Text>
        </View>
        <View style={styles(theme).banner}>
          <LoginBanner />
          <View>
            <Button
              Icon={GoogleLogo}
              label='Sign in with Google'
              onPress={onGoogleSignIn}
              containerStyle={styles(theme).loginButton}
              labelStyle={styles(theme).loginButtonText}
              indicatorColor={ThemeStatic.accent}
              loading={googleLoading}
            />
            {appleSignInButton}
            <TouchableOpacity
              // @ts-ignore
              onPress={termsAndConditionsBottomSheetRef.current.open}
              style={styles(theme).terms}>
              <Text style={styles(theme).termsText}>Terms and conditions</Text>
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  }

  return (
    <View style={styles(theme).container}>
      {content}
      <TermsAndConditionsBottomSheet ref={termsAndConditionsBottomSheetRef} />
      <ConfirmationModal
        label='Confirm'
        title='Terms and Conditions'
        description={`By clicking confirm you agree to our terms and conditions`}
        color={ThemeStatic.accent}
        isVisible={termsConfirmationModal}
        toggle={termsConfirmationToggle}
        onConfirm={processNewUser}
      />
    </View>
  );
};

const styles = (theme = {} as ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.base
  },
  content: {
    marginTop: responsiveHeight(8),
    marginHorizontal: 20
  },
  titleText: {
    ...FontWeights.Bold,
    ...FontSizes.Heading,
    color: theme.text01
  },
  subtitleText: {
    ...FontWeights.Light,
    ...FontSizes.Label,
    marginTop: 10,
    color: theme.text02
  },
  banner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: responsiveHeight(Platform.select({ ios: 10, android: 12 })),
    paddingBottom: 16,
  },
  loginButton: {
    height: 44,
    width: responsiveWidth(90),
    alignSelf: 'center',
    marginBottom: 10,
    borderWidth: Platform.select({ ios: StyleSheet.hairlineWidth, android: 0.8 }),
    borderColor: theme.accent,
    backgroundColor: theme.base
  },
  loginButtonText: {
    ...FontWeights.Regular,
    ...FontSizes.Body,
    marginLeft: 10,
    color: theme.accent
  },
  appleSignIn: {
    height: 44,
    width: responsiveWidth(90),
    marginBottom: 10
  },
  loadingAppleLogin: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  terms: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  termsText: {
    ...FontWeights.Light,
    ...FontSizes.Body,
    color: theme.text02
  }
});

export default LoginScreen;