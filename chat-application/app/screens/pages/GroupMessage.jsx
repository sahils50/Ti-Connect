import axios from "axios";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

import BlockedOverlay from "../components/BlockContact/BlockedOverlay";
import GroupChatHeader from "../components/GroupChatHeader/GroupChatHeader";
import MessagesList from "../components/MessagesList/MessagesList";
import SelectedMessagesActionBar from "../components/SelectedMessagesActionBar/SelectedMessagesActionBar";
import SendMessageBar from "../components/SenderMessage/SendMessageBar";
import * as SecureStore from "expo-secure-store";
import { useSelector } from "react-redux";
import { getSocket } from "../../services/socketService";

const GroupMessage = () => {
  // ------------------- STATE -------------------
  const [messages, setMessages] = useState([]);
  const [selectedMessages, setSelectedMessages] = useState([]);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [messageText, setMessageText] = useState("");
  const [isBlocked, setIsBlocked] = useState(false);
  const [hasLeftGroup, setHasLeftGroup] = useState(false);
  const [wallpaperUri, setWallpaperUri] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef(null);

  const currentUserId = useSelector((state) => state.auth.user.id);
  const user = useSelector((state) => state.auth.user);
  const params = useLocalSearchParams();

  // ------------------- GROUP DETAILS (safe parse) -------------------
  const GroupDetails = useMemo(() => {
    let data = params.groupedata;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (e) {
        console.error("Parse error:", e);
        return null;
      }
    }
    return data || null;
  }, [params.groupedata]);

  if (!GroupDetails?.id) {
    return (
      <SafeAreaView className="flex-1 justify-center items-center bg-slate-50">
        <Text className="text-lg text-gray-600">Invalid group</Text>
      </SafeAreaView>
    );
  }

  // ------------------- LOAD WALLPAPER -------------------
  useEffect(() => {
    (async () => {
      const uri = await AsyncStorage.getItem("chat_wallpaper");
      setWallpaperUri(uri || null);
    })();
  }, []);

  // ------------------- FETCH MESSAGES -------------------
  const fetchMessages = useCallback(async () => {
    const token = await SecureStore.getItemAsync("token");
    if (!token) return router.replace("/screens/home");

    try {
      const res = await axios.get(
        `${process.env.EXPO_API_URL}/get/group/messages`,
        {
          params: { groupId: GroupDetails.id },
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (res.data.success) {
        const normalized = res.data.messages.map((msg) => ({
          ...msg,
          _id: msg._id || msg.id,
          id: msg.id || msg._id,
          isSender: msg.sender_id === currentUserId,
        }));
        setMessages(normalized);
        setIsBlocked(res.data.isBlocked ?? false);
        setHasLeftGroup(res.data.hasLeftGroup ?? false);
      }
    } catch (err) {
      console.error("Fetch failed:", err);
    }
  }, [GroupDetails.id, currentUserId, router]);

  // ------------------- SOCKET HANDLERS -------------------
  const handleGroupNewMessage = useCallback((data) => {
    console.log("🧪 SOCKET DATA:", data); // ← DEBUG LOG

    // 🔥 FIXED: Handle ALL backend formats
    let newMessages = [];

    if (data.newGroupMessages && Array.isArray(data.newGroupMessages)) {
      newMessages = data.newGroupMessages; // ✅ Batch images
    } else if (data.newGroupMessage && typeof data.newGroupMessage === 'object') {
      newMessages = [data.newGroupMessage]; // ✅ Single message
    } else if (Array.isArray(data)) {
      newMessages = data; // ✅ Legacy array
    } else if (typeof data === 'object') {
      newMessages = [data]; // ✅ Single object
    }

    console.log("🧪 PROCESSED MESSAGES:", newMessages); // ← DEBUG LOG

    newMessages.forEach((msg) => {
      if (!msg || msg.group_id !== GroupDetails.id) return;

      const msgId = msg._id || msg.id;
      if (!msgId) return;

      setMessages((prev) => {
        const exists = prev.some((m) => (m._id || m.id) === msgId);
        if (exists) return prev;

        return [
          ...prev,
          {
            ...msg,
            _id: msgId,
            id: msgId,
            isSender: msg.sender_id === currentUserId,
          },
        ];
      });
    });
  }, [GroupDetails.id, currentUserId]);

  const handleDeletedMessage = useCallback(({ messageId }) => {
    const id = messageId?._id || messageId?.id || messageId;
    if (!id) return;
    setMessages((prev) => prev.filter((m) => m._id !== id && m.id !== id));
  }, []);

  const handleUpdatedMessage = useCallback((updatedMsg) => {
    const msgId = updatedMsg._id || updatedMsg.id;
    if (!msgId) return;
    setMessages((prev) =>
      prev.map((m) =>
        m._id === msgId || m.id === msgId
          ? { ...m, ...updatedMsg, _id: msgId, id: msgId }
          : m
      )
    );
  }, []);

  const handleMessageStatusUpdate = useCallback(
    ({ message_id, status }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m._id === message_id || m.id === message_id ? { ...m, status } : m
        )
      );
    },
    []
  );

  // ------------------- SOCKET SETUP -------------------
  useEffect(() => {
    fetchMessages();

    const socket = getSocket();
    if (!socket) return;

    socket.on("groupNewMessage", handleGroupNewMessage);
    socket.on("groupMessageDeleted", handleDeletedMessage);
    socket.on("message_updated", handleUpdatedMessage);
    socket.on("message_status_update", handleMessageStatusUpdate);

    return () => {
      socket.off("groupNewMessage", handleGroupNewMessage);
      socket.off("groupMessageDeleted", handleDeletedMessage);
      socket.off("message_updated", handleUpdatedMessage);
      socket.off("message_status_update", handleMessageStatusUpdate);
    };
  }, [
    fetchMessages,
    handleGroupNewMessage,
    handleDeletedMessage,
    handleUpdatedMessage,
    handleMessageStatusUpdate,
  ]);

  // ------------------- AUTO-SCROLL -------------------
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  // ------------------- SELECTION -------------------
  const toggleMessageSelection = (id) => {
    setSelectedMessages((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleLongPress = (item) =>
    toggleMessageSelection(item.id || item._id);

  const cancelSelection = () => {
    setSelectedMessages([]);
    setEditingMessageId(null);
    setMessageText("");
  };

  const editSelectedMessage = (message) => {
    const id = message.id || message._id;
    setEditingMessageId(id);
    setMessageText(message.message || "");
    setSelectedMessages([id]);
  };

  const deleteSelectedMessages = async (messageId = null) => {
    const ids = messageId ? [messageId] : selectedMessages;
    if (!ids.length) return;

    const token = await SecureStore.getItemAsync("token");
    if (!token) return;

    Alert.alert("Delete", `Delete ${ids.length} message(s)?`, [
      { text: "Cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await axios.delete(`${process.env.EXPO_API_URL}/messages`, {
            data: { ids },
            headers: { Authorization: `Bearer ${token}` },
          });
          setMessages((prev) =>
            prev.filter((m) => !ids.includes(m.id || m._id))
          );
          setSelectedMessages([]);
        },
      },
    ]);
  };

  // ------------------- SEND MESSAGE -------------------
  // GroupMessage.jsx  (only the handleSend part is shown)
  const handleSend = async (media) => {
    if (!messageText.trim() && !media) return;

    try {
      setIsLoading(true);
      const token = await SecureStore.getItemAsync("token");
      if (!token) return Alert.alert("Error", "Not logged in");

      const API = process.env.EXPO_API_URL;

      // ----- EDIT -----
      if (editingMessageId && !media) {
        await axios.put(
          `${API}/messages/${editingMessageId}`,
          { message: messageText },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        cancelSelection();
        return;
      }

      // ----- BATCH IMAGES (gallery) -----
      if (media?.type === "images" && media?.uris?.length) {
        const uploaded = [];
        for (const uri of media.uris) {
          const fd = new FormData();
          fd.append("groupId", GroupDetails.id);
          const ext = uri.split(".").pop() || "jpg";
          fd.append("media_url", {
            uri,
            name: `img_${Date.now()}.${ext}`,
            type: "image/jpeg",
          });

          const up = await axios.post(`${API}/groups/send/messages/upload`, fd, {
            headers: {
              "Content-Type": "multipart/form-data",
              Authorization: `Bearer ${token}`,
            },
          });
          if (up.data.success) uploaded.push(...up.data.fileUrls);
        }

        if (uploaded.length) {
          await axios.post(
            `${API}/groups/send/messages`,
            { fileUrls: uploaded, groupId: GroupDetails.id },
            { headers: { Authorization: `Bearer ${token}` } }
          );
        }
        setMessageText("");
        return;
      }

      // ----- SINGLE MEDIA (image / video / audio / doc / contact) -----
      if (media && media.type !== "text") {
        const token = await SecureStore.getItemAsync("token");

        // CONTACT – no upload
        if (media.type === "contact") {
          // ✅ Validate contact data exists
          if (!media || !media.name) {
            Alert.alert("Error", "Invalid contact data");
            return;
          }

          await axios.post(`${API}/groups/send/messages`, {
            contact_details: {                    // ✅ Now safe
              name: media.name || "Unknown",
              phone: media.phone || "",
              email: media.email || "",
            },
            groupId: GroupDetails.id,
            message_type: "contact",
            status: "sent",
          }, { headers: { Authorization: `Bearer ${token}` } });
          setMessageText("");
          return;
        }

        // UPLOAD + SEND (SINGLE FILE - SAME AS ONE-TO-ONE)
        const fd = new FormData();
        fd.append("groupId", GroupDetails.id);  // ← Group specific

        const ext = media.uri.split(".").pop() || "jpg";
        const mime = media.type === "image" ? "image/jpeg" :
          media.type === "video" ? "video/mp4" :
            media.type === "audio" ? "audio/m4a" : "application/octet-stream";

        fd.append("media_url", {
          uri: media.uri,
          name: `${media.type}_${Date.now()}.${ext}`,
          type: mime,
        });

        const up = await axios.post(`${API}/groups/send/messages/upload`, fd, {
          headers: {
            "Content-Type": "multipart/form-data",
            Authorization: `Bearer ${token}`,
          },
        });

        if (!up.data.success) {
          Alert.alert("Error", "Upload failed");
          return;
        }

        // 🔥 FIX: Use media_url (SINGLE) like one-to-one
        await axios.post(`${API}/groups/send/messages`, {
          media_url: up.data.fileUrls[0],      // ← Take FIRST item from array
          groupId: GroupDetails.id,
          message_type: media.type,
          status: "sent",
        }, { headers: { Authorization: `Bearer ${token}` } });

        setMessageText("");
        return;
      }

      // ----- TEXT -----
      if (messageText.trim()) {
        await axios.post(
          `${API}/groups/send/messages`,
          {
            message: messageText,
            groupId: GroupDetails.id,
            status: "sent",
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setMessageText("");
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Error", e.response?.data?.message || "Send failed");
    } finally {
      setIsLoading(false);
    }
  };

  // ------------------- WALLPAPER -------------------
  const handleWallpaperChange = async (uri) => {
    if (uri) {
      await AsyncStorage.setItem("chat_wallpaper", uri);
      setWallpaperUri(uri);
    } else {
      await AsyncStorage.removeItem("chat_wallpaper");
      setWallpaperUri(null);
    }
  };

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, []);

  // ------------------- RENDER -------------------
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      className="flex-1 bg-slate-50"
    >
      <StatusBar barStyle="dark-content" backgroundColor="#f8fafc" />
      <SafeAreaView className="flex-1">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View className="flex-1">
            {/* Header */}
            <GroupChatHeader
              onWallpaperChange={handleWallpaperChange}
              onBlock={() => setIsBlocked(true)}
              onClearChat={() => setMessages([])}
              GroupDetails={GroupDetails}
              onLeaveGroup={() =>
                Alert.alert("Leave Group", "Are you sure?", [
                  { text: "Cancel" },
                  {
                    text: "Leave",
                    style: "destructive",
                    onPress: () => setHasLeftGroup(true),
                  },
                ])
              }
            />

            {/* Blocked / Left UI */}
            {hasLeftGroup ? (
              <View className="flex-1 justify-center items-center px-6">
                <Text className="text-center text-lg text-gray-600">
                  You have left this group.
                </Text>
                <TouchableOpacity
                  onPress={() => router.back()}
                  className="mt-6 px-6 py-3 bg-indigo-600 rounded-full"
                >
                  <Text className="text-white font-medium">
                    Back to Groups
                  </Text>
                </TouchableOpacity>
              </View>
            ) : isBlocked ? (
              <BlockedOverlay onUnblock={() => setIsBlocked(false)} />
            ) : (
              <>
                {/* Selection Bar */}
                {selectedMessages.length > 0 && (
                  <SelectedMessagesActionBar
                    selectedCount={selectedMessages.length}
                    onEdit={editSelectedMessage}
                    onDelete={deleteSelectedMessages}
                    onCancel={cancelSelection}
                  />
                )}

                {/* Messages */}
                <MessagesList
                  type="group"
                  messages={messages}
                  setMessages={setMessages}
                  user={user}
                  GroupDetails={GroupDetails}
                  onLongPress={handleLongPress}
                  selectedMessages={selectedMessages}
                  fadeAnim={fadeAnim}
                  flatListRef={flatListRef}
                  wallpaperUri={wallpaperUri}
                  onDeleteMessage={deleteSelectedMessages}
                  onEditMessage={editSelectedMessage}
                  isLoading={isLoading}
                />

                {/* Input */}
                <SendMessageBar
                  type="group"
                  messageText={messageText}
                  setMessageText={setMessageText}
                  editingMessageId={editingMessageId}
                  cancelEditing={cancelSelection}
                  onSend={handleSend}
                  user={user}
                  handleGetMessage={fetchMessages}
                  GroupDetails={GroupDetails}
                />
              </>
            )}
          </View>
        </TouchableWithoutFeedback>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
};

export default GroupMessage;