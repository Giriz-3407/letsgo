import asyncio
from abc import ABC, abstractmethod
from typing import Dict, Optional, List
from ..models.room import RoomState

class RoomRepository(ABC):
    @abstractmethod
    async def get_room(self, room_id: str) -> Optional[RoomState]:
        pass

    @abstractmethod
    async def save_room(self, room: RoomState) -> None:
        pass

    @abstractmethod
    async def delete_room(self, room_id: str) -> bool:
        pass

    @abstractmethod
    async def list_rooms(self) -> List[RoomState]:
        pass

class InMemoryRoomRepository(RoomRepository):
    def __init__(self):
        self._rooms: Dict[str, RoomState] = {}
        self._lock = asyncio.Lock()

    async def get_room(self, room_id: str) -> Optional[RoomState]:
        async with self._lock:
            room = self._rooms.get(room_id)
            if room:
                return room.model_copy(deep=True)
            return None

    async def save_room(self, room: RoomState) -> None:
        async with self._lock:
            self._rooms[room.roomId] = room.model_copy(deep=True)

    async def delete_room(self, room_id: str) -> bool:
        async with self._lock:
            if room_id in self._rooms:
                del self._rooms[room_id]
                return True
            return False

    async def list_rooms(self) -> List[RoomState]:
        async with self._lock:
            return [r.model_copy(deep=True) for r in self._rooms.values()]

room_repository = InMemoryRoomRepository()
